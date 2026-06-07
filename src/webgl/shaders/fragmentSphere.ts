/** Sphere projection, cavity basis, and raymarching helpers. */
export const SPHERE_FRAGMENT: string = `  vec4 renderSphereVolume() {
    vec3 rayOrigin = uCameraLocal;
    vec3 rayDirection = normalize(vLocalPosition - uCameraLocal);
    float enter = 0.0;
    float exit = 0.0;
    if (!intersectUnitSphere(rayOrigin, rayDirection, enter, exit)) {
      return uSphereTransparent > 0.5 ? vec4(0.0) : vec4(uBackgroundColor, 1.0);
    }

    int steps = clamp(uSphereRaymarchSteps, 1, MAX_SPHERE_RAYMARCH_STEPS);
    float rayLength = exit - enter;
    float stepSize = rayLength / float(steps);
    vec3 accumulatedColor = vec3(0.0);
    float accumulatedAlpha = 0.0;

    for (int stepIndex = 0; stepIndex < MAX_SPHERE_RAYMARCH_STEPS; stepIndex++) {
      if (stepIndex >= steps || accumulatedAlpha > 0.965) {
        break;
      }

      float t = enter + (float(stepIndex) + 0.5) * stepSize;
      vec3 p = rayOrigin + rayDirection * t;
      float radialDistance = length(p);
      if (radialDistance > 1.0) {
        continue;
      }

      FieldSample field = evaluateCavityField(p);
      float modeScale = sqrt(max(1.0, float(uModeCount)));
      float energyScale = max(0.18, modeScale * 0.15);
      float normalizedField = field.field / energyScale;
      float nodeWidth = max(0.00045, uNodeWidth * 0.06);
      float nodeBand =
        1.0 - smoothstep(nodeWidth * 0.3, nodeWidth * 1.4, abs(normalizedField));
      float broadBand =
        1.0 - smoothstep(nodeWidth * 1.4, nodeWidth * (5.0 + uSoftness * 5.5), abs(normalizedField));
      float structure = smoothstep(0.03, 0.72 + uEdgeFade * 0.5, field.grad / energyScale);
      float edgeFade = 1.0 - smoothstep(0.94, 1.0, radialDistance);
      float shellAccent = smoothstep(0.16, 1.0, radialDistance);
      float interiorMask = 1.0 - smoothstep(0.42, 0.98, radialDistance);
      float shellWeight = mix(1.0, shellAccent, clamp(uSphereShellBias, 0.0, 1.5));
      float bodyDensity =
        broadBand *
        interiorMask *
        uSphereInteriorGlow *
        (0.08 + field.energy * 0.06);
      float featherInk = uColorMode == 4
        ? broadBand * (0.16 + uSoftness * 0.34)
        : broadBand * uSoftness * 0.06;
      float contourDensity =
        (pow(nodeBand, 2.2) * 0.88 + featherInk) *
        (0.24 + structure * 0.76) *
        (0.48 + field.energy * 0.46) *
        shellWeight;
      float density = clamp(
        (contourDensity + bodyDensity) *
          uDensity *
          uOpacity *
          edgeFade *
          (0.88 + uFeatureSignals.y * 0.24 + uFeatureSignals.w * 0.16),
        0.0,
        2.4
      );
      if (density <= 0.0001) {
        continue;
      }

      vec3 modalColor =
        field.colorWeight > 0.0001 ? field.color / field.colorWeight : vec3(0.86, 0.96, 1.0);
      vec3 monoColor = mix(uMonoColor * 0.44, mix(uMonoColor, vec3(1.0), 0.22), nodeBand);
      vec3 thermalColor = mix(uThermalColdColor, uThermalHotColor, smoothstep(-0.35, 0.35, normalizedField));
      float heat = lineFeatherHeat(
        abs(normalizedField),
        nodeWidth,
        5.0 + uSoftness * 5.5,
        0.0
      );
      vec3 heatmapColor = heatmapPalette(heat);
      vec3 bandColor = normalize(uBandEnergies + vec3(0.02)) *
        vec3(0.38, 0.74, 0.96) +
        vec3(uBandEnergies.z * 0.9, uBandEnergies.y * 0.42, uBandEnergies.x * 0.32) +
        uChromaProfile.rgb * uChromaProfile.a * 0.22;
      vec3 color = monoColor;

      if (uColorMode == 0) {
        color = mix(monoColor, modalColor, clamp(uChromesthesiaMix, 0.0, 1.0));
      } else if (uColorMode == 2) {
        color = mix(monoColor, clamp(bandColor, 0.0, 1.0), 0.72);
      } else if (uColorMode == 3) {
        color = mix(monoColor, thermalColor, 0.78);
      } else if (uColorMode == 4) {
        color = heatmapColor;
      }

      color *= 0.45 + nodeBand * 0.95 + field.energy * 0.18 + shellAccent * 0.18;
      float sampleAlpha = 1.0 - exp(-density * uSphereAbsorption * stepSize * 2.2);
      accumulatedColor += (1.0 - accumulatedAlpha) * color * sampleAlpha;
      accumulatedAlpha += (1.0 - accumulatedAlpha) * sampleAlpha;
    }

    vec3 litVolumeColor = clamp(accumulatedColor * uBrightness, 0.0, 1.0);
    if (uSphereTransparent > 0.5) {
      float outputAlpha = clamp(accumulatedAlpha * uSurfaceOpacity, 0.0, 1.0);
      return vec4(litVolumeColor, outputAlpha);
    }
    vec3 outputColor = mix(
      uBackgroundColor,
      litVolumeColor,
      clamp(accumulatedAlpha, 0.0, 1.0)
    );
    return vec4(outputColor, 1.0);
  }

`;
