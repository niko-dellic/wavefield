import * as THREE from "three";

import type { CymaticSettings, PulseBlendMode, PulseBurst } from "../types";

const MAX_CYMATIC_BURSTS = 12;

const PULSE_BLEND_MODE_INDEX: Record<PulseBlendMode, number> = {
  mix: 0,
  lighten: 1,
  screen: 2,
  average: 3,
  add: 4,
  alphaOver: 5,
  alphaMix: 6,
  maxEnergy: 7,
  overlay: 8,
};

const FULLSCREEN_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const CYMATIC_ACCUMULATION_FRAGMENT_SHADER = `
  #define MAX_CYMATIC_BURSTS ${MAX_CYMATIC_BURSTS}

  uniform sampler2D uPreviousPulse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uDecayFactor;
  uniform int uBurstCount;
  uniform int uBlendMode;
  uniform vec4 uBurstPlacements[MAX_CYMATIC_BURSTS];
  uniform vec4 uBurstMeta[MAX_CYMATIC_BURSTS];
  uniform vec3 uBurstColors[MAX_CYMATIC_BURSTS];
  uniform float uPulseOpacity;
  uniform float uFillOpacity;
  uniform float uCymaticDensity;
  uniform float uCymaticSymmetry;
  uniform float uCymaticHarmonicMix;
  uniform float uCymaticNodeWidth;
  uniform float uCymaticSoftness;
  uniform float uCymaticInterference;
  uniform float uCymaticEdgeFade;
  uniform float uCymaticWarp;
  uniform float uCymaticWarpScale;
  uniform float uCymaticDrift;
  uniform float uLightBackgroundMode;
  varying vec2 vUv;

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

  vec3 overlayBlend(vec3 historyColor, vec3 sourceColor) {
    vec3 low = 2.0 * historyColor * sourceColor;
    vec3 high = 1.0 - 2.0 * (1.0 - historyColor) * (1.0 - sourceColor);
    return vec3(
      historyColor.r < 0.5 ? low.r : high.r,
      historyColor.g < 0.5 ? low.g : high.g,
      historyColor.b < 0.5 ? low.b : high.b
    );
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 blendPulse(vec3 historyColor, vec3 sourceColor, float sourceAlpha) {
    if (uBlendMode == 0) {
      return mix(historyColor, sourceColor, sourceAlpha);
    }

    if (uBlendMode == 1) {
      return max(historyColor, sourceColor);
    }

    if (uBlendMode == 2) {
      return 1.0 - (1.0 - historyColor) * (1.0 - sourceColor);
    }

    if (uBlendMode == 4) {
      return clamp(historyColor + sourceColor, 0.0, 1.0);
    }

    if (uBlendMode == 5) {
      return clamp(sourceColor + historyColor * (1.0 - sourceAlpha), 0.0, 1.0);
    }

    if (uBlendMode == 6) {
      return mix(historyColor, sourceColor, sourceAlpha);
    }

    if (uBlendMode == 7) {
      return luma(sourceColor) > luma(historyColor) ? sourceColor : historyColor;
    }

    if (uBlendMode == 8) {
      return overlayBlend(historyColor, sourceColor);
    }

    return (historyColor + sourceColor) * 0.5;
  }

  float blendPulseAlpha(float historyAlpha, float sourceAlpha) {
    if (uBlendMode == 4) {
      return clamp(historyAlpha + sourceAlpha, 0.0, 0.98);
    }

    if (uBlendMode == 5) {
      return clamp(sourceAlpha + historyAlpha * (1.0 - sourceAlpha), 0.0, 0.98);
    }

    if (uBlendMode == 6) {
      return mix(historyAlpha, sourceAlpha, sourceAlpha);
    }

    return max(historyAlpha, sourceAlpha);
  }

  void main() {
    vec4 previousPulse = texture2D(uPreviousPulse, vUv);
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float symmetry = max(1.0, uCymaticSymmetry);
    float signedResonance = 0.0;
    float colorWeight = 0.0;
    float totalEnergy = 0.0;
    vec3 weightedColor = vec3(0.0);

    for (int index = 0; index < MAX_CYMATIC_BURSTS; index++) {
      if (index >= uBurstCount) {
        continue;
      }

      vec4 burstPlacement = uBurstPlacements[index];
      vec4 burstMeta = uBurstMeta[index];
      float reachRadius = burstPlacement.z;
      float edgeRadius = max(0.0008, burstPlacement.w);
      float intensity = burstMeta.x;
      float phaseSeed = burstMeta.y;

      if (reachRadius <= 0.0001 || intensity <= 0.0001) {
        continue;
      }

      vec2 centered = vUv - burstPlacement.xy;
      centered.x *= aspect;
      float distanceToCenter = length(centered);
      float angle = atan(centered.y, centered.x);
      float phase = phaseSeed * 6.28318530718;
      float macroNoise = fbm(
        centered * (0.45 + uCymaticWarpScale * 2.2) +
        vec2(phaseSeed * 2.1, phaseSeed * 4.7) +
        vec2(uTime * 0.01 * uCymaticDrift, -uTime * 0.008 * uCymaticDrift)
      ) - 0.5;
      float shapedReachRadius = reachRadius * max(0.42, 1.0 + macroNoise * (0.16 + uCymaticWarp * 0.38));
      float normalizedDistance = distanceToCenter / max(shapedReachRadius, 0.0001);
      float edgeFade = max(edgeRadius, reachRadius * (0.045 + uCymaticEdgeFade * 0.52 + uCymaticWarp * 0.08));
      float coreActivation =
        1.0 - smoothstep(shapedReachRadius - edgeFade, shapedReachRadius + edgeFade * 2.1, distanceToCenter);
      float edgeHalo =
        1.0 - smoothstep(shapedReachRadius + edgeFade * 0.25, shapedReachRadius + edgeFade * 4.6, distanceToCenter);
      float activation = max(coreActivation, edgeHalo * (0.22 + uCymaticEdgeFade * 0.45));
      if (activation <= 0.0001) {
        continue;
      }

      float distortionNoise =
        fbm(centered * (2.2 + uCymaticDensity * 4.2) + vec2(uTime * uCymaticDrift * 0.08, -uTime * uCymaticDrift * 0.05) + vec2(phaseSeed * 3.1, phaseSeed * 5.7))
        - 0.5;
      float distortedDistance =
        normalizedDistance +
        macroNoise * (0.05 + uCymaticWarp * 0.16) +
        distortionNoise * (0.16 * uCymaticDrift + 0.04 * uCymaticWarp) * activation;
      float warpedAngle = angle + distortionNoise * (0.18 + uCymaticDrift * 0.32) + macroNoise * uCymaticWarp * 0.22;
      float radialPhase = distortedDistance * (8.0 + uCymaticDensity * 36.0);
      float angularWave = cos(warpedAngle * symmetry + phase * 0.73);
      float secondaryAngularWave = sin(warpedAngle * (symmetry + 2.0) - phase * 0.37);
      float primaryWave = sin(radialPhase + phase);
      float modalWave = primaryWave * angularWave;
      float harmonicWave =
        sin(
          radialPhase * (1.35 + uCymaticHarmonicMix * 1.85) +
          secondaryAngularWave * (0.45 + uCymaticHarmonicMix * 1.15) +
          phase * 1.27
        );
      float resonance = mix(primaryWave, modalWave, 0.32 + uCymaticInterference * 0.46) + harmonicWave * (0.18 + uCymaticHarmonicMix * 0.68);
      float burstEnergy = activation * intensity * (1.0 - smoothstep(0.72, 1.34 + uCymaticEdgeFade * 0.8, distortedDistance));
      signedResonance += resonance * burstEnergy;
      float localWeight = burstEnergy * (0.35 + abs(resonance) * 0.65);
      weightedColor += uBurstColors[index] * localWeight;
      colorWeight += localWeight;
      totalEnergy += burstEnergy;
    }

    float normalizedResonance = signedResonance / max(totalEnergy, 1.0);
    float nodeBand = 1.0 - smoothstep(0.0, max(0.001, uCymaticNodeWidth), abs(normalizedResonance));
    float contourBody = pow(clamp(1.0 - abs(normalizedResonance), 0.0, 1.0), 2.2) * uCymaticSoftness;
    float energy = clamp(totalEnergy, 0.0, 1.2);
    vec3 tint = colorWeight > 0.0001 ? weightedColor / colorWeight : vec3(0.0);
    float opacity = clamp(uPulseOpacity, 0.0, 1.5);
    float fillOpacity = clamp(uFillOpacity, 0.0, 1.5);
    float pulsePresence = step(0.000001, totalEnergy);
    float lightMode = clamp(uLightBackgroundMode, 0.0, 1.0);
    float edgeBand = pow(nodeBand, mix(1.0, 1.55, lightMode));
    float edgeDensity = edgeBand * mix(0.34 + energy * 0.26, 0.54 + energy * 0.34, lightMode);
    float fillDensity = contourBody * fillOpacity * mix(0.16, 0.018, lightMode);
    float currentAlpha = clamp(opacity * (edgeDensity + fillDensity) * pulsePresence, 0.0, 0.92);
    vec3 currentColor = tint * currentAlpha * mix(1.18, 1.0, lightMode);

    vec3 historyColor = clamp(previousPulse.rgb * uDecayFactor, 0.0, 1.0);
    float historyAlpha = clamp(previousPulse.a * uDecayFactor, 0.0, 0.98);
    vec3 accumulatedColor = blendPulse(historyColor, clamp(currentColor, 0.0, 1.0), currentAlpha);
    float accumulatedAlpha = blendPulseAlpha(historyAlpha, currentAlpha);

    gl_FragColor = vec4(clamp(accumulatedColor, 0.0, 1.0), clamp(accumulatedAlpha, 0.0, 0.98));
  }
`;

const CYMATIC_OUTPUT_FRAGMENT_SHADER = `
  uniform sampler2D uPulseTexture;
  varying vec2 vUv;

  void main() {
    vec4 pulse = texture2D(uPulseTexture, vUv);
    float alpha = clamp(pulse.a, 0.0, 1.0);
    vec3 color = alpha > 0.0001 ? clamp(pulse.rgb / alpha, 0.0, 1.0) : vec3(0.0);
    vec3 background = vec3(0.0, 0.0, 0.0);

    gl_FragColor = vec4(mix(background, color, alpha), 1.0);
  }
`;

export class CymaticPulseRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly burstPlacementUniforms = Array.from(
    { length: MAX_CYMATIC_BURSTS },
    () => new THREE.Vector4(),
  );
  private readonly burstMetaUniforms = Array.from(
    { length: MAX_CYMATIC_BURSTS },
    () => new THREE.Vector4(),
  );
  private readonly burstColorUniforms = Array.from(
    { length: MAX_CYMATIC_BURSTS },
    () => new THREE.Color(),
  );
  private readonly accumulationMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPreviousPulse: { value: null as THREE.Texture | null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDecayFactor: { value: 1 },
      uBurstCount: { value: 0 },
      uBlendMode: { value: PULSE_BLEND_MODE_INDEX.screen },
      uBurstPlacements: { value: this.burstPlacementUniforms },
      uBurstMeta: { value: this.burstMetaUniforms },
      uBurstColors: { value: this.burstColorUniforms },
      uPulseOpacity: { value: 0.88 },
      uFillOpacity: { value: 0.72 },
      uCymaticDensity: { value: 0.82 },
      uCymaticSymmetry: { value: 6 },
      uCymaticHarmonicMix: { value: 0.34 },
      uCymaticNodeWidth: { value: 0.052 },
      uCymaticSoftness: { value: 0.38 },
      uCymaticInterference: { value: 0.62 },
      uCymaticEdgeFade: { value: 0.14 },
      uCymaticWarp: { value: 0.34 },
      uCymaticWarpScale: { value: 0.72 },
      uCymaticDrift: { value: 0.16 },
      uLightBackgroundMode: { value: 0 },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: CYMATIC_ACCUMULATION_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  private readonly outputMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPulseTexture: { value: null as THREE.Texture | null },
    },
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader: CYMATIC_OUTPUT_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  private historyReadTarget: THREE.WebGLRenderTarget | null = null;
  private historyWriteTarget: THREE.WebGLRenderTarget | null = null;
  private elapsedSeconds = 0;
  private resetRequested = true;

  constructor() {
    this.camera.position.z = 1;
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number) {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));

    this.historyReadTarget?.dispose();
    this.historyWriteTarget?.dispose();
    this.historyReadTarget = this.createHistoryTarget(targetWidth, targetHeight);
    this.historyWriteTarget = this.createHistoryTarget(targetWidth, targetHeight);
    this.accumulationMaterial.uniforms.uResolution.value.set(targetWidth, targetHeight);
    this.resetRequested = true;
  }

  requestReset() {
    this.resetRequested = true;
  }

  render(
    renderer: THREE.WebGLRenderer,
    bursts: PulseBurst[],
    settings: CymaticSettings,
    deltaSeconds: number,
  ) {
    if (!this.historyReadTarget || !this.historyWriteTarget) {
      return;
    }

    this.elapsedSeconds += Math.max(0, deltaSeconds);
    this.updateBurstUniforms(bursts);
    this.updateSettingUniforms(settings, deltaSeconds);

    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = new THREE.Color();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(previousClearColor);
    renderer.autoClear = false;

    if (this.resetRequested) {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.historyReadTarget);
      renderer.clear(true, true, true);
      renderer.setRenderTarget(this.historyWriteTarget);
      renderer.clear(true, true, true);
      this.resetRequested = false;
    }

    this.accumulationMaterial.uniforms.uPreviousPulse.value =
      this.historyReadTarget.texture;
    this.quad.material = this.accumulationMaterial;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.historyWriteTarget);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.camera);

    const swapTarget = this.historyReadTarget;
    this.historyReadTarget = this.historyWriteTarget;
    this.historyWriteTarget = swapTarget;

    this.outputMaterial.uniforms.uPulseTexture.value = this.historyReadTarget.texture;
    this.quad.material = this.outputMaterial;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.historyReadTarget?.dispose();
    this.historyWriteTarget?.dispose();
    this.accumulationMaterial.dispose();
    this.outputMaterial.dispose();
    this.quad.geometry.dispose();
  }

  private createHistoryTarget(width: number, height: number) {
    return new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });
  }

  private updateBurstUniforms(bursts: PulseBurst[]) {
    const burstCount = Math.min(MAX_CYMATIC_BURSTS, bursts.length);
    for (let index = 0; index < MAX_CYMATIC_BURSTS; index += 1) {
      const burst = bursts[index];
      if (burst && index < burstCount) {
        this.burstPlacementUniforms[index].set(
          burst.centerUv[0],
          1 - burst.centerUv[1],
          burst.reachRadius,
          burst.edgeRadius,
        );
        this.burstMetaUniforms[index].set(
          burst.intensity,
          burst.phaseSeed,
          0,
          0,
        );
        this.burstColorUniforms[index].setRGB(
          burst.color[0],
          burst.color[1],
          burst.color[2],
        );
      } else {
        this.burstPlacementUniforms[index].set(0, 0, 0, 0);
        this.burstMetaUniforms[index].set(0, 0, 0, 0);
        this.burstColorUniforms[index].setRGB(0, 0, 0);
      }
    }

    this.accumulationMaterial.uniforms.uBurstCount.value = burstCount;
  }

  private updateSettingUniforms(settings: CymaticSettings, deltaSeconds: number) {
    this.accumulationMaterial.uniforms.uTime.value = this.elapsedSeconds;
    this.accumulationMaterial.uniforms.uDecayFactor.value = Math.exp(
      -Math.max(deltaSeconds, 0) / Math.max(0.15, settings.decaySeconds),
    );
    this.accumulationMaterial.uniforms.uBlendMode.value =
      PULSE_BLEND_MODE_INDEX[settings.blendMode];
    this.accumulationMaterial.uniforms.uPulseOpacity.value = settings.pulseOpacity;
    this.accumulationMaterial.uniforms.uFillOpacity.value = settings.fillOpacity;
    this.accumulationMaterial.uniforms.uCymaticDensity.value =
      settings.cymaticDensity;
    this.accumulationMaterial.uniforms.uCymaticSymmetry.value =
      settings.cymaticSymmetry;
    this.accumulationMaterial.uniforms.uCymaticHarmonicMix.value =
      settings.cymaticHarmonicMix;
    this.accumulationMaterial.uniforms.uCymaticNodeWidth.value =
      settings.cymaticNodeWidth;
    this.accumulationMaterial.uniforms.uCymaticSoftness.value =
      settings.cymaticSoftness;
    this.accumulationMaterial.uniforms.uCymaticInterference.value =
      settings.cymaticInterference;
    this.accumulationMaterial.uniforms.uCymaticEdgeFade.value =
      settings.cymaticEdgeFade;
    this.accumulationMaterial.uniforms.uCymaticWarp.value = settings.cymaticWarp;
    this.accumulationMaterial.uniforms.uCymaticWarpScale.value =
      settings.cymaticWarpScale;
    this.accumulationMaterial.uniforms.uCymaticDrift.value =
      settings.cymaticDrift;
    this.accumulationMaterial.uniforms.uLightBackgroundMode.value =
      settings.lightBackgroundMode ? 1 : 0;
  }
}
