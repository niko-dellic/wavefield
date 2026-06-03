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
  PostEffectId,
  ProjectionMode,
  SphereProjectionType,
} from "../types";
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
};

const PROJECTION_MODE_INDEX: Record<ProjectionMode, number> = {
  screen: 0,
  sphere: 1,
};

const SPHERE_PROJECTION_TYPE_INDEX: Record<SphereProjectionType, number> = {
  triplanar: 0,
  uv: 1,
};

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  #define MAX_MODAL_MODES ${MAX_MODAL_MODES}
  #define PI 3.141592653589793

  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uModeCount;
  uniform int uBoundaryMode;
  uniform int uColorMode;
  uniform int uProjectionMode;
  uniform int uSphereProjectionType;
  uniform int uScreenAspectMode;
  uniform vec4 uModeSlots[MAX_MODAL_MODES];
  uniform vec4 uModeMeta[MAX_MODAL_MODES];
  uniform vec4 uModeColors[MAX_MODAL_MODES];
  uniform vec4 uModeDynamics[MAX_MODAL_MODES];
  uniform float uDensity;
  uniform float uSymmetry;
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
  uniform float uIdlePreview;
  uniform float uSurfaceOpacity;
  uniform float uSphereTransparent;
  varying vec2 vUv;
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

  vec2 plateUvFromScreen(vec2 uv) {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    if (uScreenAspectMode == 0) {
      vec2 centered = uv - 0.5;
      return vec2(centered.x * aspect, centered.y) + 0.5;
    }

    return uv;
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
    vec2 p = plateUvFromScreen(uv);
    vec2 drift = vec2(
      uTime * (0.013 + uDrift * 0.034 + spectrumShape * 0.012),
      -uTime * (0.011 + uDrift * 0.026 + spectrumShape * 0.009)
    );
    vec2 warp = vec2(
      fbm(p * (1.8 + uWarpScale * 3.4) + drift),
      fbm(p.yx * (1.5 + uWarpScale * 3.1) - drift.yx)
    );
    p = p + (warp - 0.5) * uWarp * (0.012 + spectrumShape * 0.008);

    for (int index = 0; index < MAX_MODAL_MODES; index++) {
      if (index >= uModeCount) {
        continue;
      }

      vec4 slot = uModeSlots[index];
      vec4 meta = uModeMeta[index];
      vec4 dynamics = uModeDynamics[index];
      float amplitude = slot.w;
      if (amplitude <= 0.0001) {
        continue;
      }

      float m = max(1.0, slot.x);
      float n = max(1.0, slot.y);
      float bandEnergy = bandValue(uBandEnergies, meta.w);
      float bandOnset = bandValue(uBandOnsets, meta.w);
      float modeDriver = dynamics.x;
      float modePulse = dynamics.y;
      float modeLayer = dynamics.z;
      float localAudio = clamp(
        bandEnergy * 1.05 +
          bandOnset * 0.74 +
          modeDriver * 1.78 +
          modePulse * 1.42 +
          uFeatureSignals.y * 0.28 +
          uFeatureSignals.z * (0.18 + modeLayer * 0.26),
        0.0,
        3.0
      );
      float baseField = chladniValue(m, n, p);
      float swappedField = chladniValue(n, m + max(0.0, floor(mod(m + n, 3.0))), p);
      float harmonicField = chladniValue(
        max(1.0, floor(m * (1.0 + uHarmonicMix * 0.42))),
        max(1.0, floor(n * (1.0 + uHarmonicMix * 0.34))),
        p
      );
      vec2 gradient = chladniGradient(m, n, p);
      float phaseMotion = cos(
        meta.x +
        uTime * (0.04 + meta.z * 0.18 + modeDriver * 0.12 + modePulse * 0.18) +
        modePulse * 1.7 +
        bandOnset * 0.8
      );
      float localField =
        baseField * (0.88 + phaseMotion * 0.12 * meta.y) +
        swappedField * uInterference * 0.28 +
        harmonicField * uHarmonicMix * (0.1 + localAudio * 0.08);
      float localInfluence =
        amplitude *
        (0.26 + localAudio * 0.22 + abs(localField) * 0.52) *
        (0.72 + meta.y * 0.34);

      fieldSample.field += localField * amplitude;
      fieldSample.grad += length(gradient) * amplitude * (0.0016 + localAudio * 0.0009);
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

  void main() {
    if (uModeCount <= 0) {
      if (uIdlePreview < 0.5) {
        gl_FragColor = vec4(vec3(0.0), 1.0);
        return;
      }

      vec2 p = plateUvFromScreen(vUv);
      float idleField = chladniValue(3.0, 5.0, p);
      float idleLine = 1.0 - smoothstep(0.008, 0.026, abs(idleField));
      gl_FragColor = vec4(vec3(0.08, 0.16, 0.2) * idleLine * 0.22, 1.0);
      return;
    }

    FieldSample field = sampleProjectedField();
    float energyScale = uProjectionMode == 0
      ? max(0.055, sqrt(max(field.energy, 0.0)) * 0.26)
      : max(0.045, sqrt(max(field.energy, 0.0)) * 0.18);
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
            (uBoundaryMode == 1 ? 0.82 : (uBoundaryMode == 2 ? 1.08 : 1.0))
        )
      : max(0.00035, uNodeWidth * 0.055 * (0.82 + audioPulse * 0.34));
    float nodeBand = 1.0 - smoothstep(nodeWidth * 0.32, nodeWidth * 1.35, abs(normalizedField));
    float broadBand =
      1.0 - smoothstep(nodeWidth * 1.4, nodeWidth * (4.2 + uSoftness * 4.0), abs(normalizedField));
    float structure = smoothstep(0.02, 0.28 + uEdgeFade * 0.36, field.grad);
    float density = clamp(
      (pow(nodeBand, 2.15) * 0.86 + broadBand * uSoftness * 0.045)
        * (0.22 + structure * 0.72)
        * (0.48 + field.energy * (uProjectionMode == 0 ? 0.32 : 0.52))
        * uDensity
        * (0.88 + uFeatureSignals.y * 0.26 + audioPulse * 0.14),
      0.0,
      1.0
    );
    float halo = pow(clamp(1.0 - abs(normalizedField), 0.0, 1.0), 4.0) *
      uSoftness *
      field.energy *
      0.08;
    float visibleInk = uProjectionMode == 0
      ? smoothstep(0.018, 0.075, density + halo)
      : 1.0;
    if (uProjectionMode == 0 && visibleInk <= 0.001) {
      gl_FragColor = vec4(vec3(0.0), 1.0);
      return;
    }
    float alpha = clamp((density + halo) * (0.92 + uRms * 0.22), 0.0, 0.86);
    vec3 modalColor =
      field.colorWeight > 0.0001 ? field.color / field.colorWeight : vec3(0.86, 0.96, 1.0);
    vec3 monoColor = mix(vec3(0.38, 0.72, 0.86), vec3(0.94, 0.98, 1.0), density);
    vec3 bandColor = normalize(uBandEnergies + vec3(0.02)) *
      vec3(0.38, 0.74, 0.96) +
      vec3(uBandEnergies.z * 0.9, uBandEnergies.y * 0.42, uBandEnergies.x * 0.32) +
      uChromaProfile.rgb * uChromaProfile.a * 0.22;
    vec3 thermalCold = vec3(0.08, 0.36, 0.9);
    vec3 thermalHot = vec3(1.0, 0.48, 0.18);
    vec3 thermalColor = mix(thermalCold, thermalHot, smoothstep(-0.35, 0.35, normalizedField));
    vec3 color = monoColor;

    if (uColorMode == 0) {
      color = mix(monoColor, modalColor, clamp(uChromesthesiaMix, 0.0, 1.0));
    } else if (uColorMode == 2) {
      color = mix(monoColor, clamp(bandColor, 0.0, 1.0), 0.72);
    } else if (uColorMode == 3) {
      color = mix(monoColor, thermalColor, 0.78);
    }

    color *=
      (0.82 + density * 0.72 + field.energy * 0.24 + audioPulse * 0.16) *
      visibleInk;
    float outputAlpha = uProjectionMode == 1
      ? (uSphereTransparent > 0.5 ? clamp(alpha * uSurfaceOpacity, 0.02, 1.0) : 1.0)
      : 1.0;
    gl_FragColor = vec4(clamp(color * alpha, 0.0, 1.0), outputAlpha);
  }
`;

export class ModalFieldRenderer {
  private readonly scene = new THREE.Scene();
  private readonly opaqueBackground = new THREE.Color(0x000000);
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly sphereCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly sphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 96),
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
      uSphereProjectionType: { value: SPHERE_PROJECTION_TYPE_INDEX.triplanar },
      uScreenAspectMode: { value: 0 },
      uModeSlots: { value: this.modeSlotUniforms },
      uModeMeta: { value: this.modeMetaUniforms },
      uModeColors: { value: this.modeColorUniforms },
      uModeDynamics: { value: this.modeDynamicsUniforms },
      uDensity: { value: 0.82 },
      uSymmetry: { value: 6 },
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
      uIdlePreview: { value: 0 },
      uSurfaceOpacity: { value: 0.64 },
      uSphereTransparent: { value: 0 },
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
  private terminalPass: EffectPass | null = null;
  private postPipelineKey = "";
  private readonly pixelationEffect = new PixelationEffect(6);
  private readonly bloomEffect = new BloomEffect({
    intensity: 0.72,
    luminanceThreshold: 0.02,
    luminanceSmoothing: 0.18,
    mipmapBlur: true,
    radius: 0.72,
  });
  private readonly terminalContourEffect = new TerminalContourEffect();
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
    this.terminalContourEffect.setSize(targetWidth, targetHeight);
  }

  requestReset() {
    this.elapsedSeconds = 0;
  }

  render(
    renderer: THREE.WebGLRenderer,
    fieldFrame: ModalFieldFrame,
    settings: CymaticSettings,
    deltaSeconds: number,
    isIdlePreview = false,
  ) {
    this.elapsedSeconds += Math.max(0, deltaSeconds);
    this.updateUniforms(fieldFrame, settings, isIdlePreview);
    this.ensureControls(renderer);

    const isSphere = settings.projectionMode === "sphere";
    const useTransparentBackground =
      isSphere && settings.sphereBackgroundTransparent;
    this.scene.background = useTransparentBackground ? null : this.opaqueBackground;
    this.material.depthTest = isSphere;
    this.material.depthWrite = isSphere && !useTransparentBackground;
    const nextSide = useTransparentBackground
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
    const camera = isSphere ? this.sphereCamera : this.screenCamera;
    const enabledPostEffects = this.getEnabledPostEffects(settings);
    if (enabledPostEffects.length > 0) {
      this.updatePostProcessing(renderer, settings, camera, enabledPostEffects);
    }

    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = new THREE.Color();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(previousClearColor);

    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setClearColor(
      0x000000,
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

    this.controls = new TrackballControls(this.sphereCamera, renderer.domElement);
    this.controls.dynamicDampingFactor = 0.012;
    this.controls.noPan = true;
    this.controls.handleResize();
    this.controls.enabled = false;
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
    if (this.terminalPass) {
      this.terminalPass.mainCamera = camera;
      this.terminalPass.enabled = true;
    }

    this.pixelationEffect.granularity = settings.postPixelSize;
    this.bloomEffect.intensity = settings.postBloomIntensity;
    this.terminalContourEffect.updateSettings(settings);
    this.rebuildPostPipeline(enabledPostEffects);
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
        case "terminal":
          return settings.terminalContourEnabled;
      }
    });
  }

  private updateUniforms(
    fieldFrame: ModalFieldFrame,
    settings: CymaticSettings,
    isIdlePreview: boolean,
  ) {
    const modes = fieldFrame.modes.slice(0, MAX_MODAL_MODES);
    for (let index = 0; index < MAX_MODAL_MODES; index += 1) {
      const mode = modes[index];
      if (mode) {
        this.modeSlotUniforms[index].set(
          mode.mode[0],
          mode.mode[1],
          mode.frequencyNorm,
          mode.amplitude,
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
          mode.driver,
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
    this.material.uniforms.uSphereProjectionType.value =
      SPHERE_PROJECTION_TYPE_INDEX[settings.sphereProjectionType];
    this.material.uniforms.uScreenAspectMode.value =
      settings.screenAspectMode === "circle" ? 0 : 1;
    this.material.uniforms.uDensity.value = settings.cymaticDensity;
    this.material.uniforms.uSymmetry.value = settings.cymaticSymmetry;
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
    this.material.uniforms.uIdlePreview.value = isIdlePreview ? 1 : 0;
    this.material.uniforms.uSurfaceOpacity.value = settings.sphereSurfaceOpacity;
    this.material.uniforms.uSphereTransparent.value =
      settings.projectionMode === "sphere" && settings.sphereBackgroundTransparent ? 1 : 0;
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
