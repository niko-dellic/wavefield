import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { MAX_MODAL_MODES, type ModalFieldFrame } from "../audio/ModalField";
import type {
  BoundaryMode,
  ColorMode,
  CymaticSettings,
  ProjectionMode,
} from "../types";

const BOUNDARY_MODE_INDEX: Record<BoundaryMode, number> = {
  dirichlet: 0,
  neumann: 1,
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
  uniform vec4 uModeSlots[MAX_MODAL_MODES];
  uniform vec4 uModeMeta[MAX_MODAL_MODES];
  uniform vec4 uModeColors[MAX_MODAL_MODES];
  uniform float uDensity;
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
  uniform float uChromesthesiaMix;
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

  float basisValue(float index, float coordinate) {
    float argument = PI * index * coordinate;
    if (uBoundaryMode == 0) {
      return sin(argument);
    }

    return cos(argument);
  }

  float basisDerivative(float index, float coordinate) {
    float angularScale = PI * index;
    float argument = angularScale * coordinate;
    if (uBoundaryMode == 0) {
      return cos(argument) * angularScale;
    }

    return -sin(argument) * angularScale;
  }

  FieldSample evaluateField(vec3 p) {
    FieldSample fieldSample;
    fieldSample.field = 0.0;
    fieldSample.grad = 0.0;
    fieldSample.energy = 0.0;
    fieldSample.color = vec3(0.0);
    fieldSample.colorWeight = 0.0;

    vec2 drift = vec2(
      uTime * (0.013 + uDrift * 0.034),
      -uTime * (0.011 + uDrift * 0.026)
    );
    float largeNoise = fbm(p.xy * (0.82 + uWarpScale * 2.4) + drift) - 0.5;
    vec3 warped = clamp(
      p + vec3(
        largeNoise * uWarp * 0.036,
        (fbm(p.yz * (1.4 + uWarpScale * 1.9) - drift.yx) - 0.5) * uWarp * 0.03,
        (fbm(p.zx * (1.2 + uWarpScale * 1.7) + drift * 0.6) - 0.5) * uWarp * 0.026
      ),
      vec3(0.0),
      vec3(1.0)
    );

    for (int index = 0; index < MAX_MODAL_MODES; index++) {
      if (index >= uModeCount) {
        continue;
      }

      vec4 slot = uModeSlots[index];
      vec4 meta = uModeMeta[index];
      float amplitude = slot.w;
      if (amplitude <= 0.0001) {
        continue;
      }

      float bx = basisValue(slot.x, warped.x);
      float by = basisValue(slot.y, warped.y);
      float bz = basisValue(slot.z, warped.z);
      float dx = basisDerivative(slot.x, warped.x) * by * bz;
      float dy = bx * basisDerivative(slot.y, warped.y) * bz;
      float dz = bx * by * basisDerivative(slot.z, warped.z);
      float standing = bx * by * bz;
      float phaseMotion = cos(meta.x + uTime * (0.12 + meta.z * 0.42));
      float harmonic = sin(
        (bx + by + bz) * (2.2 + uInterference * 4.6) +
        meta.x * 0.31
      );
      float localField =
        standing * mix(1.0, phaseMotion, 0.18 + meta.y * 0.18) +
        harmonic * amplitude * uInterference * 0.1;
      float localInfluence = amplitude * (0.42 + abs(localField) * 0.58);

      fieldSample.field += localField * amplitude;
      fieldSample.grad += length(vec3(dx, dy, dz)) * amplitude * 0.045;
      fieldSample.energy += localInfluence;
      fieldSample.color += uModeColors[index].rgb * localInfluence * uModeColors[index].a;
      fieldSample.colorWeight += localInfluence * uModeColors[index].a;
    }

    return fieldSample;
  }

  FieldSample sampleProjectedField() {
    if (uProjectionMode == 0) {
      vec2 plate = vUv;
      vec3 p = vec3(plate, 0.5 + sin(uTime * 0.09) * 0.08);
      return evaluateField(clamp(p, vec3(0.0), vec3(1.0)));
    }

    vec3 normal = normalize(vWorldNormal);
    vec3 p = normal * 0.5 + 0.5;
    vec3 weights = pow(abs(normal), vec3(4.0));
    weights /= max(0.0001, weights.x + weights.y + weights.z);

    FieldSample xy = evaluateField(vec3(p.x, p.y, p.z));
    FieldSample yz = evaluateField(vec3(p.y, p.z, p.x));
    FieldSample zx = evaluateField(vec3(p.z, p.x, p.y));
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
      vec2 centered = vUv * 2.0 - 1.0;
      float ring = 1.0 - smoothstep(0.006, 0.02, abs(length(centered) - 0.28));
      gl_FragColor = vec4(vec3(0.08, 0.16, 0.2) * ring * 0.22, 1.0);
      return;
    }

    FieldSample field = sampleProjectedField();
    float normalizedField = field.field / max(0.045, sqrt(max(field.energy, 0.0)) * 0.18);
    float nodeWidth = max(0.00035, uNodeWidth * 0.055);
    float nodeBand = 1.0 - smoothstep(nodeWidth * 0.32, nodeWidth * 1.35, abs(normalizedField));
    float broadBand =
      1.0 - smoothstep(nodeWidth * 1.4, nodeWidth * (4.2 + uSoftness * 4.0), abs(normalizedField));
    float structure = smoothstep(0.02, 0.28 + uEdgeFade * 0.36, field.grad);
    float density = clamp(
      (pow(nodeBand, 2.15) * 0.86 + broadBand * uSoftness * 0.045)
        * (0.22 + structure * 0.72)
        * (0.48 + field.energy * 0.32)
        * uDensity
        * (0.9 + uRms * 0.28 + uFlux * 0.18),
      0.0,
      1.0
    );
    float halo = pow(clamp(1.0 - abs(normalizedField), 0.0, 1.0), 4.0) *
      uSoftness *
      field.energy *
      0.12;
    float alpha = clamp((density + halo) * (0.92 + uRms * 0.22), 0.0, 0.86);
    vec3 modalColor =
      field.colorWeight > 0.0001 ? field.color / field.colorWeight : vec3(0.86, 0.96, 1.0);
    vec3 monoColor = mix(vec3(0.38, 0.72, 0.86), vec3(0.94, 0.98, 1.0), density);
    vec3 bandColor = normalize(uBandEnergies + vec3(0.02)) *
      vec3(0.38, 0.74, 0.96) +
      vec3(uBandEnergies.z * 0.9, uBandEnergies.y * 0.42, uBandEnergies.x * 0.32);
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

    color *= 0.82 + density * 0.72 + field.energy * 0.24;
    gl_FragColor = vec4(clamp(color * alpha, 0.0, 1.0), 1.0);
  }
`;

export class ModalFieldRenderer {
  private readonly scene = new THREE.Scene();
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
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uModeCount: { value: 0 },
      uBoundaryMode: { value: BOUNDARY_MODE_INDEX.neumann },
      uColorMode: { value: COLOR_MODE_INDEX.chromesthesia },
      uProjectionMode: { value: PROJECTION_MODE_INDEX.screen },
      uModeSlots: { value: this.modeSlotUniforms },
      uModeMeta: { value: this.modeMetaUniforms },
      uModeColors: { value: this.modeColorUniforms },
      uDensity: { value: 0.82 },
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
      uChromesthesiaMix: { value: 0.82 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  private controls: OrbitControls | null = null;
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
  }

  requestReset() {
    this.elapsedSeconds = 0;
  }

  render(
    renderer: THREE.WebGLRenderer,
    fieldFrame: ModalFieldFrame,
    settings: CymaticSettings,
    deltaSeconds: number,
  ) {
    this.elapsedSeconds += Math.max(0, deltaSeconds);
    this.updateUniforms(fieldFrame, settings);
    this.ensureControls(renderer);

    const isSphere = settings.projectionMode === "sphere";
    this.screenMesh.visible = !isSphere;
    this.sphereMesh.visible = isSphere;
    this.sphereMesh.scale.setScalar(settings.sphereRadius);
    this.sphereMesh.rotation.y += deltaSeconds * settings.sphereRotation;
    if (this.controls) {
      this.controls.enabled = isSphere;
      if (isSphere) {
        this.controls.update();
      }
    }

    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = new THREE.Color();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(previousClearColor);

    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, isSphere ? this.sphereCamera : this.screenCamera);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.controls?.dispose();
    this.material.dispose();
    this.screenMesh.geometry.dispose();
    this.sphereMesh.geometry.dispose();
  }

  private ensureControls(renderer: THREE.WebGLRenderer) {
    if (this.controls) {
      return;
    }

    this.controls = new OrbitControls(this.sphereCamera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.enabled = false;
  }

  private updateUniforms(fieldFrame: ModalFieldFrame, settings: CymaticSettings) {
    const modes = fieldFrame.modes.slice(0, MAX_MODAL_MODES);
    for (let index = 0; index < MAX_MODAL_MODES; index += 1) {
      const mode = modes[index];
      if (mode) {
        this.modeSlotUniforms[index].set(
          mode.indices[0],
          mode.indices[1],
          mode.indices[2],
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
      } else {
        this.modeSlotUniforms[index].set(0, 0, 0, 0);
        this.modeMetaUniforms[index].set(0, 0, 0, 0);
        this.modeColorUniforms[index].set(0, 0, 0, 0);
      }
    }

    this.material.uniforms.uTime.value = this.elapsedSeconds;
    this.material.uniforms.uModeCount.value = modes.length;
    this.material.uniforms.uBoundaryMode.value =
      BOUNDARY_MODE_INDEX[settings.boundaryMode];
    this.material.uniforms.uColorMode.value = COLOR_MODE_INDEX[settings.colorMode];
    this.material.uniforms.uProjectionMode.value =
      PROJECTION_MODE_INDEX[settings.projectionMode];
    this.material.uniforms.uDensity.value = settings.cymaticDensity;
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
    this.material.uniforms.uChromesthesiaMix.value = settings.chromesthesiaMix;
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
