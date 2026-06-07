import * as THREE from "three";

import { MAX_MODAL_MODES, type ModalFieldFrame } from "../audio/ModalField";
import {
  getBoundaryWeights,
  getFieldModelWeights,
} from "../effectiveSettings";
import type {
  BoundaryWeights,
  ColorMode,
  EffectiveCymaticSettings,
  FieldModelWeights,
  FrequencyBand,
  HeatmapPalette,
  ProjectionMode,
  SphereFieldMode,
  SphereProjectionType,
} from "../types";
import { setColorUniform } from "./colorUniforms";
import { getFisheyeUniformState } from "./fisheyeUniforms";
import type { ScreenViewTransform } from "./renderTypes";

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

/** Concrete uniform map consumed by the modal field ShaderMaterial. */
export type ModalFieldShaderUniforms = Record<string, THREE.IUniform> & {
  uResolution: THREE.IUniform<THREE.Vector2>;
  uTime: THREE.IUniform<number>;
  uModeCount: THREE.IUniform<number>;
  uFieldModelWeights: THREE.IUniform<THREE.Vector4>;
  uBoundaryWeights: THREE.IUniform<THREE.Vector4>;
  uBoundaryClampedWeight: THREE.IUniform<number>;
  uColorMode: THREE.IUniform<number>;
  uProjectionMode: THREE.IUniform<number>;
  uSphereFieldMode: THREE.IUniform<number>;
  uSphereProjectionType: THREE.IUniform<number>;
  uScreenAspectMode: THREE.IUniform<number>;
  uScreenViewOffset: THREE.IUniform<THREE.Vector2>;
  uScreenViewScale: THREE.IUniform<number>;
  uScreenViewRotation: THREE.IUniform<number>;
  uCameraLocal: THREE.IUniform<THREE.Vector3>;
  uModeSlots: THREE.IUniform<THREE.Vector4[]>;
  uModeMeta: THREE.IUniform<THREE.Vector4[]>;
  uModeColors: THREE.IUniform<THREE.Vector4[]>;
  uModeDynamics: THREE.IUniform<THREE.Vector4[]>;
  uDensity: THREE.IUniform<number>;
  uBrightness: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uHarmonicMix: THREE.IUniform<number>;
  uNodeWidth: THREE.IUniform<number>;
  uSoftness: THREE.IUniform<number>;
  uInterference: THREE.IUniform<number>;
  uEdgeFade: THREE.IUniform<number>;
  uWarp: THREE.IUniform<number>;
  uWarpScale: THREE.IUniform<number>;
  uDrift: THREE.IUniform<number>;
  uRms: THREE.IUniform<number>;
  uCentroid: THREE.IUniform<number>;
  uFlux: THREE.IUniform<number>;
  uBandEnergies: THREE.IUniform<THREE.Vector3>;
  uBandOnsets: THREE.IUniform<THREE.Vector3>;
  uFeatureSignals: THREE.IUniform<THREE.Vector4>;
  uChromaProfile: THREE.IUniform<THREE.Vector4>;
  uChromesthesiaMix: THREE.IUniform<number>;
  uBackgroundColor: THREE.IUniform<THREE.Color>;
  uMonoColor: THREE.IUniform<THREE.Color>;
  uThermalColdColor: THREE.IUniform<THREE.Color>;
  uThermalHotColor: THREE.IUniform<THREE.Color>;
  uHeatmapPalette: THREE.IUniform<number>;
  uIdlePreview: THREE.IUniform<number>;
  uSurfaceOpacity: THREE.IUniform<number>;
  uSphereTransparent: THREE.IUniform<number>;
  uSphereRaymarchSteps: THREE.IUniform<number>;
  uSphereAbsorption: THREE.IUniform<number>;
  uSphereShellBias: THREE.IUniform<number>;
  uSphereInteriorGlow: THREE.IUniform<number>;
  uFisheyeParams: THREE.IUniform<THREE.Vector4>;
  uFisheyeStrength: THREE.IUniform<number>;
};

/** Inputs required to sync one frame of runtime state into shader uniforms. */
export type ModalFieldUniformUpdate = {
  fieldFrame: ModalFieldFrame;
  settings: EffectiveCymaticSettings;
  screenView: ScreenViewTransform;
  elapsedSeconds: number;
  isIdlePreview: boolean;
  sphereCamera: THREE.Camera;
  sphereMesh: THREE.Object3D;
};

/** Owns the shader uniform objects and maps runtime frames/settings into them. */
export class ModalFieldUniformController {
  private readonly modeSlotUniforms: THREE.Vector4[] = Array.from(
    { length: MAX_MODAL_MODES },
    (): THREE.Vector4 => new THREE.Vector4(),
  );
  private readonly modeMetaUniforms: THREE.Vector4[] = Array.from(
    { length: MAX_MODAL_MODES },
    (): THREE.Vector4 => new THREE.Vector4(),
  );
  private readonly modeColorUniforms: THREE.Vector4[] = Array.from(
    { length: MAX_MODAL_MODES },
    (): THREE.Vector4 => new THREE.Vector4(),
  );
  private readonly modeDynamicsUniforms: THREE.Vector4[] = Array.from(
    { length: MAX_MODAL_MODES },
    (): THREE.Vector4 => new THREE.Vector4(),
  );
  private readonly cameraLocal = new THREE.Vector3();

  public readonly uniforms: ModalFieldShaderUniforms =
    this.createShaderUniforms();

  /** Updates the render target size uniform used for screen-space sampling. */
  public setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
  }

  /** Copies the current modal frame, audio features, settings, and camera state into shader uniforms. */
  public update({
    fieldFrame,
    settings,
    screenView,
    elapsedSeconds,
    isIdlePreview,
    sphereCamera,
    sphereMesh,
  }: ModalFieldUniformUpdate): void {
    this.updateModeUniforms(fieldFrame);

    this.uniforms.uTime.value = elapsedSeconds;
    this.uniforms.uModeCount.value = fieldFrame.modes.length;
    setFieldModelWeightsUniform(
      this.uniforms.uFieldModelWeights.value,
      settings.fieldModelWeights,
    );
    setBoundaryWeightsUniform(
      this.uniforms.uBoundaryWeights.value,
      this.uniforms.uBoundaryClampedWeight,
      settings.boundaryWeights,
    );
    this.uniforms.uColorMode.value = COLOR_MODE_INDEX[settings.colorMode];
    this.uniforms.uProjectionMode.value =
      PROJECTION_MODE_INDEX[settings.projectionMode];
    this.uniforms.uSphereFieldMode.value =
      SPHERE_FIELD_MODE_INDEX[settings.sphereFieldMode];
    this.uniforms.uSphereProjectionType.value =
      SPHERE_PROJECTION_TYPE_INDEX[settings.sphereProjectionType];
    this.uniforms.uScreenAspectMode.value =
      settings.screenAspectMode === "circle" ? 0 : 1;
    this.uniforms.uScreenViewOffset.value.set(
      screenView.offsetX,
      screenView.offsetY,
    );
    this.uniforms.uScreenViewScale.value = screenView.scale;
    this.uniforms.uScreenViewRotation.value = screenView.rotation;
    this.uniforms.uDensity.value = settings.cymaticDensity;
    this.uniforms.uBrightness.value = settings.cymaticBrightness;
    this.uniforms.uOpacity.value = settings.cymaticOpacity;
    this.uniforms.uHarmonicMix.value = settings.cymaticHarmonicMix;
    this.uniforms.uNodeWidth.value = settings.cymaticNodeWidth;
    this.uniforms.uSoftness.value = settings.cymaticSoftness;
    this.uniforms.uInterference.value = settings.cymaticInterference;
    this.uniforms.uEdgeFade.value = settings.cymaticEdgeFade;
    this.uniforms.uWarp.value = settings.cymaticWarp;
    this.uniforms.uWarpScale.value = settings.cymaticWarpScale;
    this.uniforms.uDrift.value = settings.cymaticDrift;
    this.uniforms.uRms.value = fieldFrame.rms;
    this.uniforms.uCentroid.value = fieldFrame.centroid;
    this.uniforms.uFlux.value = fieldFrame.flux;
    this.uniforms.uBandEnergies.value.set(
      fieldFrame.bands.low,
      fieldFrame.bands.mid,
      fieldFrame.bands.high,
    );
    this.uniforms.uBandOnsets.value.set(
      fieldFrame.onsets.low,
      fieldFrame.onsets.mid,
      fieldFrame.onsets.high,
    );
    this.uniforms.uFeatureSignals.value.set(
      fieldFrame.signals.structure,
      fieldFrame.signals.energy,
      fieldFrame.signals.change,
      fieldFrame.signals.pulse,
    );
    this.uniforms.uChromaProfile.value.set(
      fieldFrame.chroma.color[0],
      fieldFrame.chroma.color[1],
      fieldFrame.chroma.color[2],
      fieldFrame.chroma.confidence,
    );
    this.uniforms.uChromesthesiaMix.value = settings.chromesthesiaMix;
    setColorUniform(
      this.uniforms.uBackgroundColor.value,
      settings.backgroundColor,
      0x000000,
    );
    setColorUniform(this.uniforms.uMonoColor.value, settings.monoColor, 0x60b8db);
    setColorUniform(
      this.uniforms.uThermalColdColor.value,
      settings.thermalColdColor,
      0x145ce6,
    );
    setColorUniform(
      this.uniforms.uThermalHotColor.value,
      settings.thermalHotColor,
      0xff7a2e,
    );
    this.uniforms.uHeatmapPalette.value =
      HEATMAP_PALETTE_INDEX[settings.heatmapPalette];
    this.uniforms.uIdlePreview.value = isIdlePreview ? 1 : 0;
    this.uniforms.uSurfaceOpacity.value = settings.sphereSurfaceOpacity;
    this.uniforms.uSphereTransparent.value =
      settings.projectionMode === "sphere" && settings.sphereBackgroundTransparent ? 1 : 0;
    this.uniforms.uSphereRaymarchSteps.value = settings.sphereRaymarchSteps;
    this.uniforms.uSphereAbsorption.value = settings.sphereAbsorption;
    this.uniforms.uSphereShellBias.value = settings.sphereShellBias;
    this.uniforms.uSphereInteriorGlow.value = settings.sphereInteriorGlow;
    const fisheye = getFisheyeUniformState(settings);
    this.uniforms.uFisheyeParams.value.set(...fisheye.params);
    this.uniforms.uFisheyeStrength.value = fisheye.strength;

    if (settings.projectionMode === "sphere") {
      sphereCamera.updateMatrixWorld();
      sphereMesh.updateMatrixWorld();
      this.cameraLocal.copy(sphereCamera.position);
      sphereMesh.worldToLocal(this.cameraLocal);
      this.uniforms.uCameraLocal.value.copy(this.cameraLocal);
    }
  }

  /** Clears mode vectors that have no corresponding active slot this frame. */
  private updateModeUniforms(fieldFrame: ModalFieldFrame): void {
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
  }

  /** Builds the mutable uniform objects shared with Three.js for the material lifetime. */
  private createShaderUniforms(): ModalFieldShaderUniforms {
    return {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uModeCount: { value: 0 },
      uFieldModelWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
      uBoundaryWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
      uBoundaryClampedWeight: { value: 0 },
      uColorMode: { value: COLOR_MODE_INDEX.chromesthesia },
      uProjectionMode: { value: PROJECTION_MODE_INDEX.screen },
      uSphereFieldMode: { value: SPHERE_FIELD_MODE_INDEX.surface },
      uSphereProjectionType: { value: SPHERE_PROJECTION_TYPE_INDEX.triplanar },
      uScreenAspectMode: { value: 0 },
      uScreenViewOffset: { value: new THREE.Vector2() },
      uScreenViewScale: { value: 1 },
      uScreenViewRotation: { value: 0 },
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
      uFisheyeParams: { value: new THREE.Vector4() },
      uFisheyeStrength: { value: 0 },
    };
  }
}

function getBandIndex(band: FrequencyBand): number {
  if (band === "low") {
    return 0;
  }

  if (band === "mid") {
    return 1;
  }

  return 2;
}

function setBoundaryWeightsUniform(
  target: THREE.Vector4,
  clampedUniform: THREE.IUniform<number>,
  weights: BoundaryWeights | undefined,
): void {
  const safeWeights = weights ?? getBoundaryWeights("freePlate");
  target.set(
    safeWeights.freePlate,
    safeWeights.dirichlet,
    safeWeights.neumann,
    safeWeights.supported,
  );
  clampedUniform.value = safeWeights.clamped;
}

function setFieldModelWeightsUniform(
  target: THREE.Vector4,
  weights: FieldModelWeights | undefined,
): void {
  const safeWeights = weights ?? getFieldModelWeights("modalPlate");
  target.set(
    safeWeights.modalPlate,
    safeWeights.radialPlate,
    safeWeights.faradayPulse,
    safeWeights.spiralPhase,
  );
}
