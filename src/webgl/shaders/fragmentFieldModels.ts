/** Resonance and field-model evaluators for modal, radial, Faraday, and spiral fields. */
export const FIELD_MODEL_FRAGMENT: string = `  vec2 plateUvFromScreen(vec2 uv) {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    if (uScreenAspectMode == 0) {
      vec2 centered = uv - 0.5;
      return vec2(centered.x * aspect, centered.y) + 0.5;
    }

    return uv;
  }

  vec2 fisheyeUv(vec2 uv) {
    if (uFisheyeStrength <= 0.0001) {
      return uv;
    }

    vec2 safeResolution = max(uResolution, vec2(1.0));
    float aspect = safeResolution.x / safeResolution.y;
    vec2 centered = uv - 0.5;
    vec2 circleRadial = vec2(centered.x * aspect, centered.y);
    float circleR2 = dot(circleRadial, circleRadial) * 4.0;
    float aspectR2 = dot(centered, centered) * 4.0;
    float k1R2 = mix(circleR2, aspectR2, uFisheyeParams.y);
    float k2R2 = mix(circleR2, aspectR2, uFisheyeParams.w);
    float scale =
      1.0 +
      (uFisheyeParams.x * k1R2 + uFisheyeParams.z * k2R2 * k2R2) *
        uFisheyeStrength;
    return clamp(centered * scale + 0.5, vec2(0.0), vec2(1.0));
  }

  vec2 screenFieldUv(vec2 uv) {
    vec2 p = plateUvFromScreen(fisheyeUv(uv));
    vec2 centered = p - 0.5;
    float c = cos(uScreenViewRotation);
    float s = sin(uScreenViewRotation);
    vec2 rotated = vec2(
      c * centered.x + s * centered.y,
      -s * centered.x + c * centered.y
    );
    return rotated / max(0.0001, uScreenViewScale) + 0.5 + uScreenViewOffset;
  }

  float freeChladniValue(float m, float n, vec2 p) {
    float x = (p.x - 0.5) * 2.0;
    float y = (p.y - 0.5) * 2.0;
    return
      cos(m * PI * x) * cos(n * PI * y) -
      cos(n * PI * x) * cos(m * PI * y);
  }

  float dirichletChladniValue(float m, float n, vec2 p) {
    return sin(m * PI * p.x) * sin(n * PI * p.y);
  }

  float neumannChladniValue(float m, float n, vec2 p) {
    return cos(m * PI * p.x) * cos(n * PI * p.y);
  }

  float supportedChladniValue(float m, float n, vec2 p) {
    float partnerM = n + 1.0;
    float partnerN = m + 1.0;
    return
      sin(m * PI * p.x) * sin(n * PI * p.y) -
      0.86 * sin(partnerM * PI * p.x) * sin(partnerN * PI * p.y);
  }

  float edgeEnvelope(vec2 p) {
    vec2 q = clamp(p, vec2(0.0), vec2(1.0));
    return 16.0 * q.x * (1.0 - q.x) * q.y * (1.0 - q.y);
  }

  float clampedChladniValue(float m, float n, vec2 p) {
    return supportedChladniValue(m, n, p) * edgeEnvelope(p);
  }

  vec2 repeatedPlateCoord(vec2 p, float tileScale) {
    vec2 phase = (p - 0.5) * max(1.0, tileScale) * PI * 2.0;
    return vec2(sin(phase.x), sin(phase.y));
  }

  float squareEdgeAmount(vec2 centered) {
    vec2 q = abs(centered);
    return max(q.x, q.y);
  }

  float squareEdgeEnvelope(vec2 centered) {
    return 1.0 - smoothstep(0.78, 1.0, squareEdgeAmount(centered));
  }

  float circularEdgeEnvelope(float radius) {
    return 1.0 - smoothstep(0.9, 1.18, radius);
  }

  float resonanceEnvelope(vec2 centered, float radius) {
    float squareEnv = squareEdgeEnvelope(centered);
    float circularEnv = circularEdgeEnvelope(radius);
    float edgeAmount = max(squareEdgeAmount(centered), radius);
    float rim = smoothstep(0.58, 1.0, edgeAmount);
    float freeEnv = circularEnv;
    float pinnedEnv = squareEnv;
    float openEnv = circularEnv * (0.72 + rim * 0.58);
    float clampedEnv = squareEnv * squareEnv * circularEnv;
    float supportedEnv = squareEnv * circularEnv;
    return clamp(
      freeEnv * uBoundaryWeights.x +
        pinnedEnv * uBoundaryWeights.y +
        openEnv * uBoundaryWeights.z +
        supportedEnv * uBoundaryWeights.w +
        clampedEnv * uBoundaryClampedWeight,
      0.0,
      1.35
    );
  }

  float resonanceDetailBias() {
    return
      uBoundaryWeights.y * 0.75 +
      uBoundaryWeights.z * -0.35 +
      uBoundaryWeights.w * 1.4 +
      uBoundaryClampedWeight * 0.45;
  }

  float modalPlateValue(float m, float n, vec2 p) {
    if (uBoundaryWeights.x > 0.999) {
      return freeChladniValue(m, n, p);
    }
    if (uBoundaryWeights.y > 0.999) {
      return dirichletChladniValue(m, n, p);
    }
    if (uBoundaryWeights.z > 0.999) {
      return neumannChladniValue(m, n, p);
    }
    if (uBoundaryWeights.w > 0.999) {
      return supportedChladniValue(m, n, p);
    }
    if (uBoundaryClampedWeight > 0.999) {
      return clampedChladniValue(m, n, p);
    }

    return
      freeChladniValue(m, n, p) * uBoundaryWeights.x +
      dirichletChladniValue(m, n, p) * uBoundaryWeights.y +
      neumannChladniValue(m, n, p) * uBoundaryWeights.z +
      supportedChladniValue(m, n, p) * uBoundaryWeights.w +
      clampedChladniValue(m, n, p) * uBoundaryClampedWeight;
  }

  float radialPlateValue(float m, float n, vec2 p) {
    float tileScale = max(2.0, floor((m + n) * 0.34));
    vec2 centered = repeatedPlateCoord(p, tileScale);
    float radius = length(centered);
    float angle = atan(centered.y, centered.x);
    float detailBias = resonanceDetailBias();
    float rings = max(1.0, floor((m + n) * 0.62));
    float spokes = max(1.0, floor(abs(m - n) + 2.0));
    float ringFrequency = rings + detailBias * 0.42;
    float edge = resonanceEnvelope(centered, radius);
    float ringField = cos(ringFrequency * PI * radius - uTime * (0.03 + uDrift * 0.08));
    float spokeField = cos(spokes * angle + n * 0.37 + detailBias * 0.65);
    float crossMode =
      cos((rings + 1.0 + uBoundaryWeights.w) * PI * radius) *
      cos((spokes + 1.0) * angle);
    float clampedSpoke =
      cos((spokes + 2.0) * angle + detailBias * 0.28) *
      uBoundaryClampedWeight;
    return (
      ringField * 0.68 +
      ringField * spokeField * 0.5 +
      crossMode * (0.12 + uBoundaryWeights.w * 0.28) +
      clampedSpoke * 0.12
    ) * edge;
  }

  float faradayPulseValue(float m, float n, vec2 p) {
    float tileScale = max(1.0, floor((m + n) * 0.22));
    vec2 centered = repeatedPlateCoord(p, tileScale);
    float radius = length(centered);
    float waveBase = max(2.0, floor((m + n) * 0.72));
    float waveScale = waveBase + resonanceDetailBias() * 0.5;
    float pulse =
      0.72 +
      0.28 * cos(
        uTime * (0.9 + uFeatureSignals.w * 2.4 + uRms * 1.2) +
        uFeatureSignals.y * 2.0
      );
    vec2 d0 = vec2(1.0, 0.0);
    vec2 d1 = vec2(0.5, 0.86602540378);
    vec2 d2 = vec2(-0.5, 0.86602540378);
    float a = cos(waveScale * PI * dot(centered, d0) * pulse);
    float b = cos((waveScale + 1.0) * PI * dot(centered, d1) * pulse + m * 0.21);
    float c = cos((waveScale + 2.0) * PI * dot(centered, d2) * pulse - n * 0.17);
    float lattice = (a + b + c) * 0.28 + a * b * c * 0.42;
    float boundaryMask = mix(
      1.0,
      resonanceEnvelope(centered, radius),
      clamp(
        uBoundaryWeights.y +
          uBoundaryWeights.w +
          uBoundaryClampedWeight +
          uBoundaryWeights.z * 0.35,
        0.0,
        1.0
      )
    );
    float rimPulse =
      smoothstep(0.72, 1.0, max(squareEdgeAmount(centered), radius)) *
      uBoundaryWeights.z *
      cos((waveScale + 3.0) * PI * radius - uTime * 0.7);
    return lattice * boundaryMask + rimPulse * 0.18;
  }

  float spiralPhaseValue(float m, float n, vec2 p) {
    float tileScale = max(2.0, floor((m + n) * 0.3));
    vec2 centered = repeatedPlateCoord(p, tileScale);
    float radius = length(centered);
    float angle = atan(centered.y, centered.x);
    float arms = max(2.0, floor(mod(m + n, 6.0) + 2.0));
    float counterArms = arms + 1.0;
    float twist = arms * angle + radius * PI * (m * 0.85 + n * 0.35);
    float counterTwist = radius * PI * (n * 0.72 + 1.0) - counterArms * angle;
    float motion = uTime * (0.08 + uDrift * 0.18 + uFeatureSignals.z * 0.08);
    float edge = resonanceEnvelope(centered, radius);
    float openCurl =
      sin((arms + 1.0) * angle - radius * PI * (n * 0.34 + 1.0) + motion * 0.48) *
      uBoundaryWeights.z;
    float supportedPetal =
      sin((arms + 2.0) * angle + radius * PI * (m + n) * 0.28) *
      uBoundaryWeights.w;
    float clampedPetal =
      cos((arms + 3.0) * angle - radius * PI * (m * 0.22 + n * 0.18)) *
      uBoundaryClampedWeight;
    return (
      sin(twist + motion) * cos(counterTwist - motion * 0.72) +
      openCurl * 0.16 +
      supportedPetal * 0.22 +
      clampedPetal * 0.14
    ) * edge;
  }

  float chladniValue(float m, float n, vec2 p) {
    if (uFieldModelWeights.x > 0.999) {
      return modalPlateValue(m, n, p);
    }
    if (uFieldModelWeights.y > 0.999) {
      return radialPlateValue(m, n, p);
    }
    if (uFieldModelWeights.z > 0.999) {
      return faradayPulseValue(m, n, p);
    }
    if (uFieldModelWeights.w > 0.999) {
      return spiralPhaseValue(m, n, p);
    }

    return
      modalPlateValue(m, n, p) * uFieldModelWeights.x +
      radialPlateValue(m, n, p) * uFieldModelWeights.y +
      faradayPulseValue(m, n, p) * uFieldModelWeights.z +
      spiralPhaseValue(m, n, p) * uFieldModelWeights.w;
  }

  vec2 freeChladniGradient(float m, float n, vec2 p) {
    float x = (p.x - 0.5) * 2.0;
    float y = (p.y - 0.5) * 2.0;
    float dx =
      -2.0 * m * PI * sin(m * PI * x) * cos(n * PI * y) +
      2.0 * n * PI * sin(n * PI * x) * cos(m * PI * y);
    float dy =
      -2.0 * n * PI * cos(m * PI * x) * sin(n * PI * y) +
      2.0 * m * PI * cos(n * PI * x) * sin(m * PI * y);
    return vec2(dx, dy);
  }

  vec2 dirichletChladniGradient(float m, float n, vec2 p) {
    return vec2(
      m * PI * cos(m * PI * p.x) * sin(n * PI * p.y),
      n * PI * sin(m * PI * p.x) * cos(n * PI * p.y)
    );
  }

  vec2 neumannChladniGradient(float m, float n, vec2 p) {
    return vec2(
      -m * PI * sin(m * PI * p.x) * cos(n * PI * p.y),
      -n * PI * cos(m * PI * p.x) * sin(n * PI * p.y)
    );
  }

  vec2 supportedChladniGradient(float m, float n, vec2 p) {
    float partnerM = n + 1.0;
    float partnerN = m + 1.0;
    return vec2(
      m * PI * cos(m * PI * p.x) * sin(n * PI * p.y) -
        0.86 * partnerM * PI * cos(partnerM * PI * p.x) *
          sin(partnerN * PI * p.y),
      n * PI * sin(m * PI * p.x) * cos(n * PI * p.y) -
        0.86 * partnerN * PI * sin(partnerM * PI * p.x) *
          cos(partnerN * PI * p.y)
    );
  }

  vec2 edgeEnvelopeGradient(vec2 p) {
    vec2 q = clamp(p, vec2(0.0), vec2(1.0));
    return vec2(
      16.0 * (1.0 - 2.0 * q.x) * q.y * (1.0 - q.y),
      16.0 * q.x * (1.0 - q.x) * (1.0 - 2.0 * q.y)
    );
  }

  vec2 clampedChladniGradient(float m, float n, vec2 p) {
    float supported = supportedChladniValue(m, n, p);
    return
      supportedChladniGradient(m, n, p) * edgeEnvelope(p) +
      supported * edgeEnvelopeGradient(p);
  }

  vec2 modalPlateGradient(float m, float n, vec2 p) {
    if (uBoundaryWeights.x > 0.999) {
      return freeChladniGradient(m, n, p);
    }
    if (uBoundaryWeights.y > 0.999) {
      return dirichletChladniGradient(m, n, p);
    }
    if (uBoundaryWeights.z > 0.999) {
      return neumannChladniGradient(m, n, p);
    }
    if (uBoundaryWeights.w > 0.999) {
      return supportedChladniGradient(m, n, p);
    }
    if (uBoundaryClampedWeight > 0.999) {
      return clampedChladniGradient(m, n, p);
    }

    return
      freeChladniGradient(m, n, p) * uBoundaryWeights.x +
      dirichletChladniGradient(m, n, p) * uBoundaryWeights.y +
      neumannChladniGradient(m, n, p) * uBoundaryWeights.z +
      supportedChladniGradient(m, n, p) * uBoundaryWeights.w +
      clampedChladniGradient(m, n, p) * uBoundaryClampedWeight;
  }

  float nonModalFieldValue(float m, float n, vec2 p) {
    if (uFieldModelWeights.y > 0.999) {
      return radialPlateValue(m, n, p);
    }
    if (uFieldModelWeights.z > 0.999) {
      return faradayPulseValue(m, n, p);
    }
    if (uFieldModelWeights.w > 0.999) {
      return spiralPhaseValue(m, n, p);
    }

    return
      radialPlateValue(m, n, p) * uFieldModelWeights.y +
      faradayPulseValue(m, n, p) * uFieldModelWeights.z +
      spiralPhaseValue(m, n, p) * uFieldModelWeights.w;
  }

  float nonModalGradientMagnitudeProxy(float m, float n, vec2 p, float fieldValue) {
    float modelScale =
      uFieldModelWeights.y * 0.92 +
      uFieldModelWeights.z * 1.14 +
      uFieldModelWeights.w * 1.06;
    float frequencyScale = max(1.0, m + n);
    float centeredEdge = max(squareEdgeAmount(p - 0.5), length((p - 0.5) * 2.0));
    float edgeBoost = 0.74 + smoothstep(0.34, 1.0, centeredEdge) * 0.48;
    float resonanceScale = 0.88 + abs(resonanceDetailBias()) * 0.16;
    return
      (0.32 + abs(fieldValue) * 0.72) *
      frequencyScale *
      modelScale *
      edgeBoost *
      resonanceScale;
  }

  float chladniGradientMagnitude(float m, float n, vec2 p, float fieldValue) {
    if (uFieldModelWeights.x > 0.999) {
      return length(modalPlateGradient(m, n, p));
    }

    float nonModalWeight = clamp(
      uFieldModelWeights.y + uFieldModelWeights.z + uFieldModelWeights.w,
      0.0,
      1.0
    );
    float modalMagnitude =
      uFieldModelWeights.x > 0.0001
        ? length(modalPlateGradient(m, n, p)) * uFieldModelWeights.x
        : 0.0;
    return
      modalMagnitude +
      nonModalGradientMagnitudeProxy(m, n, p, fieldValue) * nonModalWeight;
  }

  float clampedCavityEnvelope(float coordinate) {
    float q = clamp(coordinate, 0.0, 1.0);
    return 4.0 * q * (1.0 - q);
  }

  float clampedCavityEnvelopeDerivative(float coordinate) {
    float q = clamp(coordinate, 0.0, 1.0);
    return 4.0 * (1.0 - 2.0 * q);
  }

  float cavityBasisValue(float modeIndex, float coordinate) {
    float argument = modeIndex * PI * coordinate;
    float sine = sin(argument);
    return
      cos(argument) * (uBoundaryWeights.x + uBoundaryWeights.z) +
      sine * (uBoundaryWeights.y + uBoundaryWeights.w) +
      sine * clampedCavityEnvelope(coordinate) * uBoundaryClampedWeight;
  }

  float cavityBasisDerivative(float modeIndex, float coordinate) {
    float angularScale = modeIndex * PI;
    float argument = angularScale * coordinate;
    float sine = sin(argument);
    float cosine = cos(argument);
    return
      -sine * angularScale * (uBoundaryWeights.x + uBoundaryWeights.z) +
      cosine * angularScale * (uBoundaryWeights.y + uBoundaryWeights.w) +
      (
        cosine * angularScale * clampedCavityEnvelope(coordinate) +
        sine * clampedCavityEnvelopeDerivative(coordinate)
      ) * uBoundaryClampedWeight;
  }

  void accumulateCavityPermutation(
    float u,
    float v,
    float w,
    vec3 p,
    inout float field,
    inout vec3 gradient
  ) {
    float bx = cavityBasisValue(u, p.x);
    float by = cavityBasisValue(v, p.y);
    float bz = cavityBasisValue(w, p.z);
    float dx = cavityBasisDerivative(u, p.x);
    float dy = cavityBasisDerivative(v, p.y);
    float dz = cavityBasisDerivative(w, p.z);
    field += bx * by * bz;
    gradient += vec3(dx * by * bz, bx * dy * bz, bx * by * dz);
  }

  FieldSample evaluateCavityField(vec3 p) {
    FieldSample fieldSample;
    fieldSample.field = 0.0;
    fieldSample.grad = 0.0;
    fieldSample.energy = 0.0;
    fieldSample.color = vec3(0.0);
    fieldSample.colorWeight = 0.0;

    for (int index = 0; index < MAX_MODAL_MODES; index++) {
      if (index >= uModeCount) {
        break;
      }

      vec4 slot = uModeSlots[index];
      vec4 meta = uModeMeta[index];
      vec4 dynamics = uModeDynamics[index];
      float topologyWeight = slot.w;
      if (topologyWeight <= 0.0001) {
        continue;
      }

      float u = max(1.0, slot.x);
      float v = max(1.0, slot.y);
      float w = max(1.0, slot.z);
      float bandEnergy = bandValue(uBandEnergies, meta.w);
      float bandOnset = bandValue(uBandOnsets, meta.w);
      float modeExcitation = dynamics.x;
      float modePulse = dynamics.y;
      float modeLayer = dynamics.z;
      float localAudio = clamp(
        bandEnergy * 1.05 +
          bandOnset * 0.74 +
          modeExcitation * 1.78 +
          modePulse * 1.42 +
          uFeatureSignals.y * 0.28 +
          uFeatureSignals.z * (0.18 + modeLayer * 0.26),
        0.0,
        3.0
      );
      float familyField = 0.0;
      vec3 familyGradient = vec3(0.0);

      accumulateCavityPermutation(u, v, w, p, familyField, familyGradient);
      if (abs(u - w) > 0.5) {
        if (abs(u - v) < 0.5) {
          accumulateCavityPermutation(u, w, v, p, familyField, familyGradient);
          accumulateCavityPermutation(w, u, v, p, familyField, familyGradient);
          familyField *= 0.57735026919;
          familyGradient *= 0.57735026919;
        } else if (abs(v - w) < 0.5) {
          accumulateCavityPermutation(v, u, w, p, familyField, familyGradient);
          accumulateCavityPermutation(v, w, u, p, familyField, familyGradient);
          familyField *= 0.57735026919;
          familyGradient *= 0.57735026919;
        } else {
          accumulateCavityPermutation(u, w, v, p, familyField, familyGradient);
          accumulateCavityPermutation(v, u, w, p, familyField, familyGradient);
          accumulateCavityPermutation(w, u, v, p, familyField, familyGradient);
          accumulateCavityPermutation(v, w, u, p, familyField, familyGradient);
          accumulateCavityPermutation(w, v, u, p, familyField, familyGradient);
          familyField *= 0.40824829046;
          familyGradient *= 0.40824829046;
        }
      }

      float nonModalWeight = clamp(
        uFieldModelWeights.y + uFieldModelWeights.z + uFieldModelWeights.w,
        0.0,
        1.0
      );
      if (nonModalWeight > 0.0001) {
        vec2 xy = p.xy * 0.5 + 0.5;
        vec2 yz = p.yz * 0.5 + 0.5;
        vec2 zx = p.zx * 0.5 + 0.5;
        float xyField = nonModalFieldValue(u, v, xy);
        float yzField = nonModalFieldValue(v, w, yz);
        float zxField = nonModalFieldValue(w, u, zx);
        float projectedField =
          (xyField + yzField + zxField) * 0.57735026919;
        float projectedGrad =
          (
            nonModalGradientMagnitudeProxy(u, v, xy, xyField) +
            nonModalGradientMagnitudeProxy(v, w, yz, yzField) +
            nonModalGradientMagnitudeProxy(w, u, zx, zxField)
          ) * 0.33333333333;
        familyField = familyField * uFieldModelWeights.x + projectedField;
        familyGradient =
          familyGradient * uFieldModelWeights.x +
          vec3(projectedGrad * nonModalWeight);
      }

      float phaseMotion = cos(
        meta.x +
        uTime * (0.035 + meta.z * 0.14 + modeExcitation * 0.1 + modePulse * 0.16) +
        modePulse * 1.4 +
        bandOnset * 0.7
      );
      float localField = familyField * (0.9 + phaseMotion * 0.1 * meta.y);
      float modeWeight = topologyWeight * (0.62 + topologyWeight * 0.38);
      float localInfluence =
        modeWeight *
        (0.46 + localAudio * 0.2 + abs(localField) * 0.58) *
        (0.72 + meta.y * 0.34);

      fieldSample.field += localField * modeWeight * (0.82 + modeExcitation * 0.16);
      fieldSample.grad += length(familyGradient) * modeWeight;
      fieldSample.energy += localInfluence;
      fieldSample.color += uModeColors[index].rgb * localInfluence * uModeColors[index].a;
      fieldSample.colorWeight += localInfluence * uModeColors[index].a;
    }

    return fieldSample;
  }

  FieldSample evaluateChladniField(vec2 uv) {
    FieldSample fieldSample;
    fieldSample.field = 0.0;
    fieldSample.grad = 0.0;
    fieldSample.energy = 0.0;
    fieldSample.color = vec3(0.0);
    fieldSample.colorWeight = 0.0;

    float spectrumShape = clamp(
      dot(uBandEnergies, vec3(0.24, 0.38, 0.52)) +
      uFeatureSignals.y * 0.44 +
      uFeatureSignals.z * 0.38 +
      uFeatureSignals.w * 0.3,
      0.0,
      3.0
    );
    vec2 p = uProjectionMode == 0 ? screenFieldUv(uv) : plateUvFromScreen(uv);
    // Domain warp is opt-in: skip the (expensive) fbm pair entirely when uWarp is 0.
    if (uWarp > 0.0) {
      vec2 drift = vec2(
        uTime * (0.013 + uDrift * 0.034 + spectrumShape * 0.012),
        -uTime * (0.011 + uDrift * 0.026 + spectrumShape * 0.009)
      );
      vec2 warp = vec2(
        fbm(p * (1.8 + uWarpScale * 3.4) + drift),
        fbm(p.yx * (1.5 + uWarpScale * 3.1) - drift.yx)
      );
      p = p + (warp - 0.5) * uWarp * (0.012 + spectrumShape * 0.008);
    }

    for (int index = 0; index < MAX_MODAL_MODES; index++) {
      if (index >= uModeCount) {
        break;
      }

      vec4 slot = uModeSlots[index];
      vec4 meta = uModeMeta[index];
      vec4 dynamics = uModeDynamics[index];
      float topologyWeight = slot.w;
      if (topologyWeight <= 0.0001) {
        continue;
      }

      float m = max(1.0, slot.x);
      float n = max(1.0, slot.y);
      float bandEnergy = bandValue(uBandEnergies, meta.w);
      float bandOnset = bandValue(uBandOnsets, meta.w);
      float modeExcitation = dynamics.x;
      float modePulse = dynamics.y;
      float modeLayer = dynamics.z;
      float localAudio = clamp(
        bandEnergy * 1.05 +
          bandOnset * 0.74 +
          modeExcitation * 1.78 +
          modePulse * 1.42 +
          uFeatureSignals.y * 0.28 +
          uFeatureSignals.z * (0.18 + modeLayer * 0.26),
        0.0,
        3.0
      );
      float baseField = chladniValue(m, n, p);
      // Transposed, detuned partner figure — overlapping it with the base mode
      // produces moiré nodal lines, the classic "interference" lattice.
      // Both interference and harmonic terms are opt-in: skip their extra
      // chladni evaluations when the corresponding control is at 0.
      float interferenceField =
        uInterference > 0.0 ? chladniValue(n, m + 1.0, p) : 0.0;
      float harmonicField =
        uHarmonicMix > 0.0
          ? chladniValue(
              max(1.0, floor(m * 1.42)),
              max(1.0, floor(n * 1.34)),
              p
            )
          : 0.0;
      float gradientMagnitude = chladniGradientMagnitude(m, n, p, baseField);
      // Audio feeds motion (phase travel + transient ring), not a flat glow.
      float phaseMotion = cos(
        meta.x +
        uTime * (0.04 + meta.z * 0.18 + modeExcitation * 0.12 + modePulse * 0.22) +
        modePulse * 1.7 +
        bandOnset * 0.8
      );
      // Interference and harmonic overtone are independent, user-controlled
      // textures layered on the dominant figure.
      float localField =
        baseField * (0.9 + phaseMotion * 0.1 * meta.y) +
        interferenceField * uInterference * 0.34 +
        harmonicField * uHarmonicMix * 0.22;
      // Emphasise the dominant mode so the strongest figure reads cleanly
      // instead of every mode averaging into mush.
      float modeWeight = topologyWeight * (0.62 + topologyWeight * 0.38);
      float localInfluence =
        modeWeight *
        (0.5 + localAudio * 0.2 + abs(localField) * 0.62) *
        (0.72 + meta.y * 0.34);

      fieldSample.field += localField * modeWeight * (0.82 + modeExcitation * 0.16);
      fieldSample.grad += gradientMagnitude * modeWeight * (0.0018 + localAudio * 0.0007);
      fieldSample.energy += localInfluence;
      fieldSample.color += uModeColors[index].rgb * localInfluence * uModeColors[index].a;
      fieldSample.colorWeight += localInfluence * uModeColors[index].a;
    }

    return fieldSample;
  }

  FieldSample sampleProjectedField() {
    if (uProjectionMode == 0) {
      return evaluateChladniField(vUv);
    }

    vec3 normal = normalize(vWorldNormal);
    vec3 p = normal * 0.5 + 0.5;

    if (uSphereProjectionType == 1) {
      return evaluateChladniField(vUv);
    }

    vec3 weights = pow(abs(normal), vec3(4.0));
    weights /= max(0.0001, weights.x + weights.y + weights.z);

    FieldSample xy = evaluateChladniField(vec2(p.x, p.y));
    FieldSample yz = evaluateChladniField(vec2(p.y, p.z));
    FieldSample zx = evaluateChladniField(vec2(p.z, p.x));
    FieldSample combined;
    combined.field = xy.field * weights.z + yz.field * weights.x + zx.field * weights.y;
    combined.grad = xy.grad * weights.z + yz.grad * weights.x + zx.grad * weights.y;
    combined.energy = xy.energy * weights.z + yz.energy * weights.x + zx.energy * weights.y;
    combined.color = xy.color * weights.z + yz.color * weights.x + zx.color * weights.y;
    combined.colorWeight =
      xy.colorWeight * weights.z +
      yz.colorWeight * weights.x +
      zx.colorWeight * weights.y;
    return combined;
  }

  bool intersectUnitSphere(vec3 origin, vec3 direction, out float enter, out float exit) {
    float b = dot(origin, direction);
    float c = dot(origin, origin) - 1.0;
    float discriminant = b * b - c;
    if (discriminant <= 0.0) {
      return false;
    }

    float root = sqrt(discriminant);
    enter = max(0.0, -b - root);
    exit = -b + root;
    return exit > enter;
  }

`;
