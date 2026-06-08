/** Shared fragment declarations, uniforms, noise, and signal helpers. */
export const SHARED_FRAGMENT: string = `
  #define MAX_SPHERE_RAYMARCH_STEPS 96
  #define PI 3.141592653589793

  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uModeCount;
  uniform vec4 uFieldModelWeights;
  uniform vec4 uBoundaryWeights;
  uniform float uBoundaryClampedWeight;
  uniform int uColorMode;
  uniform int uProjectionMode;
  uniform int uSphereFieldMode;
  uniform int uSphereProjectionType;
  uniform int uScreenAspectMode;
  uniform vec2 uScreenViewOffset;
  uniform float uScreenViewScale;
  uniform float uScreenViewRotation;
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
  uniform vec4 uFisheyeParams;
  uniform float uFisheyeStrength;
  uniform vec4 uTerminalParams;
  uniform vec2 uTerminalControls;
  uniform float uTerminalStrength;
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

`;
