import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  PixelationEffect,
  RenderPass,
} from "postprocessing";

import { MAX_MODAL_MODES, type ModalFieldFrame } from "../audio/ModalField";
import type {
  BoundaryMode,
  ColorMode,
  CymaticSettings,
  HeatmapPalette,
  PostEffectId,
  ProjectionMode,
  SphereFieldMode,
  SphereProjectionType,
} from "../types";
import { AlphaDecayPass } from "./AlphaDecayPass";
import { FisheyeEffect } from "./FisheyeEffect";
import { TerminalContourEffect } from "./TerminalContourEffect";

const BOUNDARY_MODE_INDEX: Record<BoundaryMode, number> = {
  freePlate: 0,
  dirichlet: 1,
  neumann: 2,
};

const COLOR_MODE_INDEX: Record<ColorMode, number> = {
  chromesthesia: 0,
  mono: 1,
  bandSplit: 2,
  thermalPhase: 3,
  heatmap: 4,
};

const HEATMAP_PALETTE_INDEX: Record<HeatmapPalette, number> = {
  scientificHeat: 0,
  blackbody: 1,
  turbo: 2,
};

const PROJECTION_MODE_INDEX: Record<ProjectionMode, number> = {
  screen: 0,
  sphere: 1,
};

const SPHERE_PROJECTION_TYPE_INDEX: Record<SphereProjectionType, number> = {
  triplanar: 0,
  uv: 1,
};

const SPHERE_FIELD_MODE_INDEX: Record<SphereFieldMode, number> = {
  surface: 0,
  volume: 1,
};

const SPHERE_ROTATION_DAMPING_FACTOR = 0.012;
const SPHERE_ZOOM_DAMPING_FACTOR = 1;

type TrackballControlsWithInternals = TrackballControls & {
  _zoomCamera: () => void;
};

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vLocalPosition = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  #define MAX_MODAL_MODES ${MAX_MODAL_MODES}
  #define MAX_SPHERE_RAYMARCH_STEPS 96
  #define PI 3.141592653589793

  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uModeCount;
  uniform int uBoundaryMode;
  uniform int uColorMode;
  uniform int uProjectionMode;
  uniform int uSphereFieldMode;
  uniform int uSphereProjectionType;
  uniform int uScreenAspectMode;
  uniform vec2 uScreenViewOffset;
  uniform float uScreenViewScale;
  uniform vec3 uCameraLocal;
  uniform vec4 uModeSlots[MAX_MODAL_MODES];
  uniform vec4 uModeMeta[MAX_MODAL_MODES];
  uniform vec4 uModeColors[MAX_MODAL_MODES];
  uniform vec4 uModeDynamics[MAX_MODAL_MODES];
  uniform float uDensity;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform float uHarmonicMix;
  uniform float uNodeWidth;
  uniform float uSoftness;
  uniform float uInterference;
  uniform float uEdgeFade;
  uniform float uWarp;
  uniform float uWarpScale;
  uniform float uDrift;
  uniform float uRms;
  uniform float uCentroid;
  uniform float uFlux;
  uniform vec3 uBandEnergies;
  uniform vec3 uBandOnsets;
  uniform vec4 uFeatureSignals;
  uniform vec4 uChromaProfile;
  uniform float uChromesthesiaMix;
  uniform vec3 uBackgroundColor;
  uniform vec3 uMonoColor;
  uniform vec3 uThermalColdColor;
  uniform vec3 uThermalHotColor;
  uniform int uHeatmapPalette;
  uniform float uIdlePreview;
  uniform float uSurfaceOpacity;
  uniform float uSphereTransparent;
  uniform int uSphereRaymarchSteps;
  uniform float uSphereAbsorption;
  uniform float uSphereShellBias;
  uniform float uSphereInteriorGlow;
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;

  struct FieldSample {
    float field;
    float grad;
    float energy;
    vec3 color;
    float colorWeight;
  };

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(19.2, 11.4);
      amplitude *= 0.5;
    }
    return value;
  }

  float bandValue(vec3 values, float bandIndex) {
    if (bandIndex < 0.5) {
      return values.x;
    }

    if (bandIndex < 1.5) {
      return values.y;
    }

    return values.z;
  }

  vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    float x = clamp(t, 0.0, 1.0);
    if (x < 0.33) {
      return mix(a, b, smoothstep(0.0, 0.33, x));
    }

    if (x < 0.68) {
      return mix(b, c, smoothstep(0.33, 0.68, x));
    }

    return mix(c, d, smoothstep(0.68, 1.0, x));
  }

  vec3 heatmapPalette(float heat) {
    float t = clamp(heat, 0.0, 1.0);
    if (uHeatmapPalette == 1) {
      return ramp4(
        t,
        vec3(0.025, 0.0, 0.0),
        vec3(0.58, 0.03, 0.0),
        vec3(1.0, 0.48, 0.05),
        vec3(1.0, 0.96, 0.72)
      );
    }

    if (uHeatmapPalette == 2) {
      return ramp4(
        t,
        vec3(0.28, 0.05, 0.58),
        vec3(0.05, 0.46, 0.92),
        vec3(0.08, 0.86, 0.42),
        vec3(1.0, 0.08, 0.02)
      );
    }

    return ramp4(
      t,
      vec3(0.02, 0.08, 0.42),
      vec3(0.0, 0.78, 0.92),
      vec3(1.0, 0.92, 0.18),
      vec3(1.0, 0.12, 0.02)
    );
  }

  float lineFeatherHeat(float fieldDistance, float nodeWidth, float featherScale, float haloHeat) {
    float lineDistance = fieldDistance / max(0.00001, nodeWidth);
    float featherDistance = clamp(lineDistance / max(1.0, featherScale), 0.0, 1.0);
    float heat = pow(1.0 - smoothstep(0.0, 1.0, featherDistance), 0.78);
    return clamp(max(heat, haloHeat), 0.0, 1.0);
  }

  vec2 plateUvFromScreen(vec2 uv) {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    if (uScreenAspectMode == 0) {
      vec2 centered = uv - 0.5;
      return vec2(centered.x * aspect, centered.y) + 0.5;
    }

    return uv;
  }

  vec2 screenFieldUv(vec2 uv) {
    vec2 p = plateUvFromScreen(uv);
    return (p - 0.5) / max(0.0001, uScreenViewScale) + 0.5 + uScreenViewOffset;
  }

  float chladniValue(float m, float n, vec2 p) {
    if (uBoundaryMode == 1) {
      return sin(m * PI * p.x) * sin(n * PI * p.y);
    }

    if (uBoundaryMode == 2) {
      return cos(m * PI * p.x) * cos(n * PI * p.y);
    }

    float x = (p.x - 0.5) * 2.0;
    float y = (p.y - 0.5) * 2.0;
    return
      cos(m * PI * x) * cos(n * PI * y) -
      cos(n * PI * x) * cos(m * PI * y);
  }

  vec2 chladniGradient(float m, float n, vec2 p) {
    if (uBoundaryMode == 1) {
      return vec2(
        m * PI * cos(m * PI * p.x) * sin(n * PI * p.y),
        n * PI * sin(m * PI * p.x) * cos(n * PI * p.y)
      );
    }

    if (uBoundaryMode == 2) {
      return vec2(
        -m * PI * sin(m * PI * p.x) * cos(n * PI * p.y),
        -n * PI * cos(m * PI * p.x) * sin(n * PI * p.y)
      );
    }

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

  float cavityBasisValue(float modeIndex, float coordinate) {
    float argument = modeIndex * PI * coordinate;
    if (uBoundaryMode == 1) {
      return sin(argument);
    }

    return cos(argument);
  }

  float cavityBasisDerivative(float modeIndex, float coordinate) {
    float angularScale = modeIndex * PI;
    float argument = angularScale * coordinate;
    if (uBoundaryMode == 1) {
      return cos(argument) * angularScale;
    }

    return -sin(argument) * angularScale;
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
              max(1.0, floor(m * (1.0 + uHarmonicMix * 0.42))),
              max(1.0, floor(n * (1.0 + uHarmonicMix * 0.34))),
              p
            )
          : 0.0;
      vec2 gradient = chladniGradient(m, n, p);
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
      fieldSample.grad += length(gradient) * modeWeight * (0.0018 + localAudio * 0.0007);
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

  vec4 renderSphereVolume() {
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

  void main() {
    if (uProjectionMode == 1 && uSphereFieldMode == 1 && uModeCount > 0) {
      gl_FragColor = renderSphereVolume();
      return;
    }

    if (uModeCount <= 0) {
      if (uIdlePreview < 0.5) {
        gl_FragColor = vec4(uBackgroundColor, 1.0);
        return;
      }

      vec2 p = screenFieldUv(vUv);
      float idleField = chladniValue(3.0, 5.0, p);
      float idleLine = 1.0 - smoothstep(0.008, 0.026, abs(idleField));
      vec3 idleColor = uBackgroundColor + vec3(0.08, 0.16, 0.2) * idleLine * 0.22;
      gl_FragColor = vec4(clamp(idleColor, 0.0, 1.0), 1.0);
      return;
    }

    FieldSample field = sampleProjectedField();
    float modeScale = sqrt(max(1.0, float(uModeCount)));
    float energyScale = uProjectionMode == 0
      ? max(0.22, modeScale * 0.18)
      : max(0.18, modeScale * 0.15);
    float normalizedField = field.field / energyScale;
    float audioPulse = clamp(
      uFeatureSignals.w * 0.88 + uFeatureSignals.z * 0.3 + uRms * 0.16,
      0.0,
      1.8
    );
    float nodeWidth = uProjectionMode == 0
      ? max(
          0.00042,
          uNodeWidth *
            0.035 *
            (0.85 + audioPulse * 0.3) *
            (uBoundaryMode == 1 ? 0.82 : (uBoundaryMode == 2 ? 1.08 : 1.0))
        )
      : max(0.00035, uNodeWidth * 0.055 * (0.82 + audioPulse * 0.34));
    float nodeBand = 1.0 - smoothstep(nodeWidth * 0.32, nodeWidth * 1.35, abs(normalizedField));
    float broadBand =
      1.0 - smoothstep(nodeWidth * 1.4, nodeWidth * (4.2 + uSoftness * 4.0), abs(normalizedField));
    float structure = smoothstep(0.02, 0.28 + uEdgeFade * 0.36, field.grad);
    float featherInk = uColorMode == 4
      ? broadBand * (0.2 + uSoftness * 0.38)
      : broadBand * uSoftness * 0.06;
    float density = clamp(
      (pow(nodeBand, 2.0) * 1.0 + featherInk)
        * (0.4 + structure * 0.6)
        * (0.66 + field.energy * (uProjectionMode == 0 ? 0.42 : 0.52))
        * uDensity
        * (0.92 + uFeatureSignals.y * 0.26 + audioPulse * 0.14),
      0.0,
      1.0
    );
    float halo = pow(clamp(1.0 - abs(normalizedField), 0.0, 1.0), 4.0) *
      uSoftness *
      field.energy *
      0.1;
    float visibleInk = uProjectionMode == 0
      ? smoothstep(0.005, 0.04, density + halo)
      : 1.0;
    if (uProjectionMode == 0 && visibleInk <= 0.001) {
      gl_FragColor = vec4(uBackgroundColor, 1.0);
      return;
    }
    float alpha = clamp((density + halo) * (0.96 + uRms * 0.22) * uOpacity, 0.0, 1.0);
    vec3 modalColor =
      field.colorWeight > 0.0001 ? field.color / field.colorWeight : vec3(0.86, 0.96, 1.0);
    vec3 monoColor = mix(uMonoColor * 0.5, mix(uMonoColor, vec3(1.0), 0.24), density);
    vec3 bandColor = normalize(uBandEnergies + vec3(0.02)) *
      vec3(0.38, 0.74, 0.96) +
      vec3(uBandEnergies.z * 0.9, uBandEnergies.y * 0.42, uBandEnergies.x * 0.32) +
      uChromaProfile.rgb * uChromaProfile.a * 0.22;
    vec3 thermalColor = mix(uThermalColdColor, uThermalHotColor, smoothstep(-0.35, 0.35, normalizedField));
    float haloHeat = clamp(halo * (3.0 + uSoftness * 3.0), 0.0, 0.2);
    float heat = lineFeatherHeat(
      abs(normalizedField),
      nodeWidth,
      4.2 + uSoftness * 4.0,
      haloHeat
    );
    vec3 heatmapColor = heatmapPalette(heat);
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

    color *=
      (0.82 + density * 0.72 + field.energy * 0.24 + audioPulse * 0.16) *
      visibleInk *
      uBrightness;
    vec3 litColor = clamp(color, 0.0, 1.0);
    if (uProjectionMode == 1 && uSphereTransparent > 0.5) {
      float outputAlpha = clamp(alpha * uSurfaceOpacity, 0.02, 1.0);
      gl_FragColor = vec4(clamp(litColor * alpha, 0.0, 1.0), outputAlpha);
      return;
    }
    gl_FragColor = vec4(mix(uBackgroundColor, litColor, alpha), 1.0);
  }
`;

export type ScreenViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export class ModalFieldRenderer {
  private readonly scene = new THREE.Scene();
  private readonly opaqueBackground = new THREE.Color(0x000000);
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly sphereCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly sphereMesh = new THREE.Mesh(
    // The mesh is only a proxy surface; all shape/shading happens in the
    // fragment shader (triplanar + raymarch), so a coarse sphere is plenty.
    new THREE.SphereGeometry(1, 96, 64),
  );
  private readonly modeSlotUniforms = Array.from(
    { length: MAX_MODAL_MODES },
    () => new THREE.Vector4(),
  );
  private readonly modeMetaUniforms = Array.from(
    { length: MAX_MODAL_MODES },
    () => new THREE.Vector4(),
  );
  private readonly modeColorUniforms = Array.from(
    { length: MAX_MODAL_MODES },
    () => new THREE.Vector4(),
  );
  private readonly modeDynamicsUniforms = Array.from(
    { length: MAX_MODAL_MODES },
    () => new THREE.Vector4(),
  );
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uModeCount: { value: 0 },
      uBoundaryMode: { value: BOUNDARY_MODE_INDEX.freePlate },
      uColorMode: { value: COLOR_MODE_INDEX.chromesthesia },
      uProjectionMode: { value: PROJECTION_MODE_INDEX.screen },
      uSphereFieldMode: { value: SPHERE_FIELD_MODE_INDEX.surface },
      uSphereProjectionType: { value: SPHERE_PROJECTION_TYPE_INDEX.triplanar },
      uScreenAspectMode: { value: 0 },
      uScreenViewOffset: { value: new THREE.Vector2() },
      uScreenViewScale: { value: 1 },
      uCameraLocal: { value: new THREE.Vector3(0, 0, 3.7) },
      uModeSlots: { value: this.modeSlotUniforms },
      uModeMeta: { value: this.modeMetaUniforms },
      uModeColors: { value: this.modeColorUniforms },
      uModeDynamics: { value: this.modeDynamicsUniforms },
      uDensity: { value: 0.82 },
      uBrightness: { value: 1.35 },
      uOpacity: { value: 1.1 },
      uHarmonicMix: { value: 0.34 },
      uNodeWidth: { value: 0.052 },
      uSoftness: { value: 0.38 },
      uInterference: { value: 0.62 },
      uEdgeFade: { value: 0.14 },
      uWarp: { value: 0.34 },
      uWarpScale: { value: 0.72 },
      uDrift: { value: 0.16 },
      uRms: { value: 0 },
      uCentroid: { value: 0 },
      uFlux: { value: 0 },
      uBandEnergies: { value: new THREE.Vector3() },
      uBandOnsets: { value: new THREE.Vector3() },
      uFeatureSignals: { value: new THREE.Vector4() },
      uChromaProfile: { value: new THREE.Vector4(0.86, 0.96, 1, 0) },
      uChromesthesiaMix: { value: 0.82 },
      uBackgroundColor: { value: new THREE.Color(0x000000) },
      uMonoColor: { value: new THREE.Color(0x60b8db) },
      uThermalColdColor: { value: new THREE.Color(0x145ce6) },
      uThermalHotColor: { value: new THREE.Color(0xff7a2e) },
      uHeatmapPalette: { value: HEATMAP_PALETTE_INDEX.scientificHeat },
      uIdlePreview: { value: 0 },
      uSurfaceOpacity: { value: 0.64 },
      uSphereTransparent: { value: 0 },
      uSphereRaymarchSteps: { value: 56 },
      uSphereAbsorption: { value: 1.35 },
      uSphereShellBias: { value: 0.65 },
      uSphereInteriorGlow: { value: 0.35 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  private controls: TrackballControls | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private pixelationPass: EffectPass | null = null;
  private bloomPass: EffectPass | null = null;
  private fisheyePass: EffectPass | null = null;
  private alphaDecayPass: AlphaDecayPass | null = null;
  private terminalPass: EffectPass | null = null;
  private postPipelineKey = "";
  private alphaDecayResetKey = "";
  private readonly pixelationEffect = new PixelationEffect(6);
  private readonly bloomEffect = new BloomEffect({
    intensity: 0.72,
    luminanceThreshold: 0.02,
    luminanceSmoothing: 0.18,
    mipmapBlur: true,
    radius: 0.72,
  });
  private readonly fisheyeEffect = new FisheyeEffect();
  private readonly terminalContourEffect = new TerminalContourEffect();
  private readonly cameraLocal = new THREE.Vector3();
  private readonly previousClearColor = new THREE.Color();
  private elapsedSeconds = 0;

  constructor() {
    this.screenCamera.position.z = 1;
    this.sphereCamera.position.set(0, 0, 3.7);
    this.screenMesh.frustumCulled = false;
    this.screenMesh.material = this.material;
    this.sphereMesh.material = this.material;
    this.sphereMesh.visible = false;
    this.scene.add(this.screenMesh, this.sphereMesh);
  }

  setSize(width: number, height: number) {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    this.material.uniforms.uResolution.value.set(targetWidth, targetHeight);
    this.sphereCamera.aspect = targetWidth / targetHeight;
    this.sphereCamera.updateProjectionMatrix();
    this.controls?.handleResize();
    this.composer?.setSize(targetWidth, targetHeight, false);
    this.fisheyeEffect.setSize(targetWidth, targetHeight);
    this.alphaDecayPass?.setSize(targetWidth, targetHeight);
    this.terminalContourEffect.setSize(targetWidth, targetHeight);
  }

  requestReset() {
    this.elapsedSeconds = 0;
  }

  render(
    renderer: THREE.WebGLRenderer,
    fieldFrame: ModalFieldFrame,
    settings: CymaticSettings,
    screenView: ScreenViewTransform,
    deltaSeconds: number,
    isIdlePreview = false,
  ) {
    this.elapsedSeconds += Math.max(0, deltaSeconds);
    this.ensureControls(renderer);

    const isSphere = settings.projectionMode === "sphere";
    const isVolumeSphere = isSphere && settings.sphereFieldMode === "volume";
    const useTransparentBackground =
      isSphere && settings.sphereBackgroundTransparent;
    setColorUniform(this.opaqueBackground, settings.backgroundColor, 0x000000);
    this.scene.background = useTransparentBackground ? null : this.opaqueBackground;
    this.material.depthTest = isSphere;
    this.material.depthWrite = isSphere && !useTransparentBackground;
    const nextSide = isVolumeSphere
      ? THREE.FrontSide
      : useTransparentBackground
      ? THREE.DoubleSide
      : THREE.FrontSide;
    if (this.material.side !== nextSide) {
      this.material.side = nextSide;
      this.material.needsUpdate = true;
    }
    this.screenMesh.visible = !isSphere;
    this.sphereMesh.visible = isSphere;
    this.sphereMesh.scale.setScalar(settings.sphereRadius);
    if (this.controls) {
      this.controls.enabled = isSphere;
      if (isSphere) {
        this.controls.update();
      }
    }
    this.updateUniforms(fieldFrame, settings, screenView, isIdlePreview);
    const camera = isSphere ? this.sphereCamera : this.screenCamera;
    const enabledPostEffects = this.getEnabledPostEffects(settings);
    if (enabledPostEffects.length > 0) {
      this.updatePostProcessing(renderer, settings, camera, enabledPostEffects);
    }

    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = this.previousClearColor;
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(previousClearColor);

    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setClearColor(
      this.opaqueBackground,
      useTransparentBackground ? 0 : 1,
    );
    renderer.clear(true, true, true);
    if (enabledPostEffects.length > 0) {
      this.composer?.render(deltaSeconds);
    } else {
      renderer.render(this.scene, camera);
    }

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.controls?.dispose();
    this.composer?.dispose();
    this.material.dispose();
    this.screenMesh.geometry.dispose();
    this.sphereMesh.geometry.dispose();
  }

  private ensureControls(renderer: THREE.WebGLRenderer) {
    if (this.controls) {
      return;
    }

    const controls = new TrackballControls(this.sphereCamera, renderer.domElement);
    controls.dynamicDampingFactor = SPHERE_ROTATION_DAMPING_FACTOR;
    useImmediateZoomDamping(controls);
    controls.noPan = true;
    controls.handleResize();
    controls.enabled = false;
    this.controls = controls;
  }

  private ensureComposer(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (this.composer) {
      return;
    }

    this.composer = new EffectComposer(renderer, {
      depthBuffer: true,
      multisampling: 0,
    });
    this.renderPass = new RenderPass(this.scene, camera);
    this.pixelationPass = new EffectPass(camera, this.pixelationEffect);
    this.bloomPass = new EffectPass(camera, this.bloomEffect);
    this.fisheyePass = new EffectPass(camera, this.fisheyeEffect);
    this.alphaDecayPass = new AlphaDecayPass();
    this.terminalPass = new EffectPass(camera, this.terminalContourEffect);
  }

  private updatePostProcessing(
    renderer: THREE.WebGLRenderer,
    settings: CymaticSettings,
    camera: THREE.Camera,
    enabledPostEffects: PostEffectId[],
  ) {
    this.ensureComposer(renderer, camera);

    if (this.composer) {
      this.composer.setMainScene(this.scene);
      this.composer.setMainCamera(camera);
    }
    if (this.renderPass) {
      this.renderPass.mainScene = this.scene;
      this.renderPass.mainCamera = camera;
    }
    if (this.pixelationPass) {
      this.pixelationPass.mainCamera = camera;
      this.pixelationPass.enabled = true;
    }
    if (this.bloomPass) {
      this.bloomPass.mainCamera = camera;
      this.bloomPass.enabled = true;
    }
    if (this.fisheyePass) {
      this.fisheyePass.mainCamera = camera;
      this.fisheyePass.enabled = true;
    }
    if (this.alphaDecayPass) {
      this.alphaDecayPass.enabled = true;
    }
    if (this.terminalPass) {
      this.terminalPass.mainCamera = camera;
      this.terminalPass.enabled = true;
    }

    this.pixelationEffect.granularity = settings.postPixelSize;
    this.bloomEffect.intensity = settings.postBloomIntensity;
    this.fisheyeEffect.updateSettings(settings);
    this.alphaDecayPass?.updateSettings(settings);
    this.resetAlphaDecayHistoryIfNeeded(settings);
    this.terminalContourEffect.updateSettings(settings);
    this.rebuildPostPipeline(enabledPostEffects);
  }

  private resetAlphaDecayHistoryIfNeeded(settings: CymaticSettings) {
    const resetKey = [
      settings.projectionMode,
      settings.sphereFieldMode,
      settings.sphereBackgroundTransparent,
      settings.backgroundColor,
      settings.postProcessingEnabled,
      settings.postAlphaDecayEnabled,
      settings.postEffectOrder.join(">"),
    ].join(":");

    if (resetKey !== this.alphaDecayResetKey) {
      this.alphaDecayPass?.resetHistory();
      this.alphaDecayResetKey = resetKey;
    }
  }

  private rebuildPostPipeline(enabledPostEffects: PostEffectId[]) {
    if (!this.composer || !this.renderPass) {
      return;
    }

    const pipelineKey = enabledPostEffects.join(">");
    if (pipelineKey === this.postPipelineKey) {
      return;
    }

    this.composer.removeAllPasses();
    this.composer.addPass(this.renderPass);
    for (const effectId of enabledPostEffects) {
      const pass = this.getPostPass(effectId);
      if (pass) {
        this.composer.addPass(pass);
      }
    }
    this.postPipelineKey = pipelineKey;
  }

  private getPostPass(effectId: PostEffectId) {
    switch (effectId) {
      case "bloom":
        return this.bloomPass;
      case "pixelation":
        return this.pixelationPass;
      case "fisheye":
        return this.fisheyePass;
      case "alphaDecay":
        return this.alphaDecayPass;
      case "terminal":
        return this.terminalPass;
    }
  }

  private getEnabledPostEffects(settings: CymaticSettings): PostEffectId[] {
    if (!settings.postProcessingEnabled) {
      return [];
    }

    return settings.postEffectOrder.filter((effectId) => {
      switch (effectId) {
        case "bloom":
          return settings.postBloomEnabled;
        case "pixelation":
          return settings.postPixelationEnabled;
        case "fisheye":
          return settings.postFisheyeEnabled;
        case "alphaDecay":
          return settings.postAlphaDecayEnabled;
        case "terminal":
          return settings.terminalContourEnabled;
      }
    });
  }

  private updateUniforms(
    fieldFrame: ModalFieldFrame,
    settings: CymaticSettings,
    screenView: ScreenViewTransform,
    isIdlePreview: boolean,
  ) {
    // ModeBank.selectSlots already caps length at min(MAX_MODAL_MODES, modalCount),
    // so the frame's modes can be read directly without an extra slice/allocation.
    const modes = fieldFrame.modes;
    for (let index = 0; index < MAX_MODAL_MODES; index += 1) {
      const mode = modes[index];
      if (mode) {
        this.modeSlotUniforms[index].set(
          mode.mode[0],
          mode.mode[1],
          mode.sphericalMode[2],
          mode.topology,
        );
        this.modeMetaUniforms[index].set(
          mode.phase,
          mode.coherence,
          mode.frequencyNorm,
          getBandIndex(mode.band),
        );
        this.modeColorUniforms[index].set(
          mode.color[0],
          mode.color[1],
          mode.color[2],
          mode.colorWeight,
        );
        this.modeDynamicsUniforms[index].set(
          mode.excitation,
          mode.pulse,
          mode.layer,
          fieldFrame.signals.harmonicity,
        );
      } else {
        this.modeSlotUniforms[index].set(0, 0, 0, 0);
        this.modeMetaUniforms[index].set(0, 0, 0, 0);
        this.modeColorUniforms[index].set(0, 0, 0, 0);
        this.modeDynamicsUniforms[index].set(0, 0, 0, 0);
      }
    }

    this.material.uniforms.uTime.value = this.elapsedSeconds;
    this.material.uniforms.uModeCount.value = modes.length;
    this.material.uniforms.uBoundaryMode.value =
      BOUNDARY_MODE_INDEX[settings.boundaryMode];
    this.material.uniforms.uColorMode.value = COLOR_MODE_INDEX[settings.colorMode];
    this.material.uniforms.uProjectionMode.value =
      PROJECTION_MODE_INDEX[settings.projectionMode];
    this.material.uniforms.uSphereFieldMode.value =
      SPHERE_FIELD_MODE_INDEX[settings.sphereFieldMode];
    this.material.uniforms.uSphereProjectionType.value =
      SPHERE_PROJECTION_TYPE_INDEX[settings.sphereProjectionType];
    this.material.uniforms.uScreenAspectMode.value =
      settings.screenAspectMode === "circle" ? 0 : 1;
    this.material.uniforms.uScreenViewOffset.value.set(
      screenView.offsetX,
      screenView.offsetY,
    );
    this.material.uniforms.uScreenViewScale.value = screenView.scale;
    this.material.uniforms.uDensity.value = settings.cymaticDensity;
    this.material.uniforms.uBrightness.value = settings.cymaticBrightness;
    this.material.uniforms.uOpacity.value = settings.cymaticOpacity;
    this.material.uniforms.uHarmonicMix.value = settings.cymaticHarmonicMix;
    this.material.uniforms.uNodeWidth.value = settings.cymaticNodeWidth;
    this.material.uniforms.uSoftness.value = settings.cymaticSoftness;
    this.material.uniforms.uInterference.value = settings.cymaticInterference;
    this.material.uniforms.uEdgeFade.value = settings.cymaticEdgeFade;
    this.material.uniforms.uWarp.value = settings.cymaticWarp;
    this.material.uniforms.uWarpScale.value = settings.cymaticWarpScale;
    this.material.uniforms.uDrift.value = settings.cymaticDrift;
    this.material.uniforms.uRms.value = fieldFrame.rms;
    this.material.uniforms.uCentroid.value = fieldFrame.centroid;
    this.material.uniforms.uFlux.value = fieldFrame.flux;
    this.material.uniforms.uBandEnergies.value.set(
      fieldFrame.bands.low,
      fieldFrame.bands.mid,
      fieldFrame.bands.high,
    );
    this.material.uniforms.uBandOnsets.value.set(
      fieldFrame.onsets.low,
      fieldFrame.onsets.mid,
      fieldFrame.onsets.high,
    );
    this.material.uniforms.uFeatureSignals.value.set(
      fieldFrame.signals.structure,
      fieldFrame.signals.energy,
      fieldFrame.signals.change,
      fieldFrame.signals.pulse,
    );
    this.material.uniforms.uChromaProfile.value.set(
      fieldFrame.chroma.color[0],
      fieldFrame.chroma.color[1],
      fieldFrame.chroma.color[2],
      fieldFrame.chroma.confidence,
    );
    this.material.uniforms.uChromesthesiaMix.value = settings.chromesthesiaMix;
    setColorUniform(
      this.material.uniforms.uBackgroundColor.value,
      settings.backgroundColor,
      0x000000,
    );
    setColorUniform(
      this.material.uniforms.uMonoColor.value,
      settings.monoColor,
      0x60b8db,
    );
    setColorUniform(
      this.material.uniforms.uThermalColdColor.value,
      settings.thermalColdColor,
      0x145ce6,
    );
    setColorUniform(
      this.material.uniforms.uThermalHotColor.value,
      settings.thermalHotColor,
      0xff7a2e,
    );
    this.material.uniforms.uHeatmapPalette.value =
      HEATMAP_PALETTE_INDEX[settings.heatmapPalette];
    this.material.uniforms.uIdlePreview.value = isIdlePreview ? 1 : 0;
    this.material.uniforms.uSurfaceOpacity.value = settings.sphereSurfaceOpacity;
    this.material.uniforms.uSphereTransparent.value =
      settings.projectionMode === "sphere" && settings.sphereBackgroundTransparent ? 1 : 0;
    this.material.uniforms.uSphereRaymarchSteps.value =
      settings.sphereRaymarchSteps;
    this.material.uniforms.uSphereAbsorption.value = settings.sphereAbsorption;
    this.material.uniforms.uSphereShellBias.value = settings.sphereShellBias;
    this.material.uniforms.uSphereInteriorGlow.value = settings.sphereInteriorGlow;
    if (settings.projectionMode === "sphere") {
      this.sphereCamera.updateMatrixWorld();
      this.sphereMesh.updateMatrixWorld();
      this.cameraLocal.copy(this.sphereCamera.position);
      this.sphereMesh.worldToLocal(this.cameraLocal);
      this.material.uniforms.uCameraLocal.value.copy(this.cameraLocal);
    }
  }
}

function getBandIndex(band: string) {
  if (band === "low") {
    return 0;
  }

  if (band === "mid") {
    return 1;
  }

  return 2;
}

function setColorUniform(target: THREE.Color, color: string, fallback: number) {
  if (/^#[\da-f]{6}$/i.test(color)) {
    target.set(color);
  } else {
    target.set(fallback);
  }
}

function useImmediateZoomDamping(controls: TrackballControls) {
  const controlsWithInternals = controls as TrackballControlsWithInternals;
  const zoomCamera = controlsWithInternals._zoomCamera.bind(controls);

  controlsWithInternals._zoomCamera = () => {
    const rotationDampingFactor = controls.dynamicDampingFactor;
    controls.dynamicDampingFactor = SPHERE_ZOOM_DAMPING_FACTOR;
    zoomCamera();
    controls.dynamicDampingFactor = rotationDampingFactor;
  };
}
