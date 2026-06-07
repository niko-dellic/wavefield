import * as THREE from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  PixelationEffect,
  RenderPass,
  type Pass,
} from "postprocessing";

import type {
  EffectiveCymaticSettings,
  PostEffectAmounts,
  PostEffectId,
} from "../types";
import { AlphaDecayPass } from "./AlphaDecayPass";
import { FisheyeEffect } from "./FisheyeEffect";
import { TerminalContourEffect } from "./TerminalContourEffect";

const POST_EFFECT_ENABLED_KEYS = {
  bloom: "postBloomEnabled",
  pixelation: "postPixelationEnabled",
  fisheye: "postFisheyeEnabled",
  alphaDecay: "postAlphaDecayEnabled",
  terminal: "terminalContourEnabled",
} satisfies Record<PostEffectId, keyof EffectiveCymaticSettings>;

/** Owns postprocessing composer state, pass ordering, and transition fade amounts. */
export class PostProcessingPipeline {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private pixelationPass: EffectPass | null = null;
  private bloomPass: EffectPass | null = null;
  private fisheyePass: EffectPass | null = null;
  private alphaDecayPass: AlphaDecayPass | null = null;
  private terminalPass: EffectPass | null = null;
  private postPipelineKey = "";
  private alphaDecayResetKey = "";
  private currentWidth = 1;
  private currentHeight = 1;
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

  /** Resizes composer targets and effect-specific buffers to match the canvas. */
  public setSize(width: number, height: number): void {
    this.currentWidth = width;
    this.currentHeight = height;
    this.composer?.setSize(width, height, false);
    this.fisheyeEffect.setSize(width, height);
    this.alphaDecayPass?.setSize(width, height);
    this.terminalContourEffect.setSize(width, height);
  }

  /** Clears temporal history so reset actions do not leave stale trails. */
  public requestReset(): void {
    this.alphaDecayPass?.resetHistory();
    this.alphaDecayResetKey = "";
  }

  /** Renders through the active post pipeline and returns true when it handled the frame. */
  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: EffectiveCymaticSettings,
    deltaSeconds: number,
  ): boolean {
    const enabledPostEffects = this.getEnabledPostEffects(settings);
    if (enabledPostEffects.length === 0) {
      return false;
    }

    this.updatePostProcessing(renderer, scene, camera, settings, enabledPostEffects);
    this.composer?.render(deltaSeconds);
    return true;
  }

  /** Releases composer resources owned by the postprocessing package. */
  public dispose(): void {
    this.composer?.dispose();
  }

  private ensureComposer(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    if (this.composer) {
      return;
    }

    this.composer = new EffectComposer(renderer, {
      depthBuffer: true,
      multisampling: 0,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.pixelationPass = new EffectPass(camera, this.pixelationEffect);
    this.bloomPass = new EffectPass(camera, this.bloomEffect);
    this.fisheyePass = new EffectPass(camera, this.fisheyeEffect);
    this.alphaDecayPass = new AlphaDecayPass();
    this.terminalPass = new EffectPass(camera, this.terminalContourEffect);
    this.setSize(this.currentWidth, this.currentHeight);
  }

  private updatePostProcessing(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: EffectiveCymaticSettings,
    enabledPostEffects: PostEffectId[],
  ): void {
    this.ensureComposer(renderer, scene, camera);
    this.updateSceneAndCamera(scene, camera);

    this.pixelationEffect.granularity = THREE.MathUtils.lerp(
      1,
      settings.postPixelSize,
      getPostEffectAmount(settings, "pixelation"),
    );
    this.bloomEffect.intensity =
      settings.postBloomIntensity * getPostEffectAmount(settings, "bloom");
    this.fisheyeEffect.updateSettings(settings, getPostEffectAmount(settings, "fisheye"));
    this.alphaDecayPass?.updateSettings(
      settings,
      getPostEffectAmount(settings, "alphaDecay"),
    );
    this.resetAlphaDecayHistoryIfNeeded(settings);
    this.terminalContourEffect.updateSettings(
      settings,
      getPostEffectAmount(settings, "terminal"),
    );
    this.rebuildPostPipeline(enabledPostEffects);
  }

  /** Keeps reusable passes pointed at the current screen or sphere camera. */
  private updateSceneAndCamera(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.composer) {
      this.composer.setMainScene(scene);
      this.composer.setMainCamera(camera);
    }
    if (this.renderPass) {
      this.renderPass.mainScene = scene;
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
  }

  /** Resets alpha history when settings change in ways that invalidate accumulated frames. */
  private resetAlphaDecayHistoryIfNeeded(settings: EffectiveCymaticSettings): void {
    const resetKey = [
      settings.projectionMode,
      settings.fieldModel,
      settings.sphereFieldMode,
      settings.sphereBackgroundTransparent,
      settings.backgroundColor,
      settings.postProcessingEnabled,
      getPostEffectAmount(settings, "alphaDecay") > 0.001,
      settings.postEffectOrder.join(">"),
    ].join(":");

    if (resetKey !== this.alphaDecayResetKey) {
      this.alphaDecayPass?.resetHistory();
      this.alphaDecayResetKey = resetKey;
    }
  }

  private rebuildPostPipeline(enabledPostEffects: PostEffectId[]): void {
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

  private getPostPass(effectId: PostEffectId): Pass | null {
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

  private getEnabledPostEffects(settings: EffectiveCymaticSettings): PostEffectId[] {
    const amounts = getPostEffectAmounts(settings);
    const hasEnabledEffect = settings.postEffectOrder.some(
      (effectId: PostEffectId): boolean => isPostEffectEnabled(settings, effectId),
    );
    if (
      !settings.postProcessingEnabled &&
      !hasEnabledEffect &&
      !hasActivePostEffectAmount(amounts)
    ) {
      return [];
    }

    return settings.postEffectOrder.filter((effectId: PostEffectId): boolean => {
      return isPostEffectEnabled(settings, effectId) || amounts[effectId] > 0.001;
    });
  }
}

function getPostEffectAmounts(settings: EffectiveCymaticSettings): PostEffectAmounts {
  return settings.postEffectAmounts ?? {
    bloom: settings.postProcessingEnabled && settings.postBloomEnabled ? 1 : 0,
    pixelation:
      settings.postProcessingEnabled && settings.postPixelationEnabled ? 1 : 0,
    fisheye: settings.postProcessingEnabled && settings.postFisheyeEnabled ? 1 : 0,
    alphaDecay:
      settings.postProcessingEnabled && settings.postAlphaDecayEnabled ? 1 : 0,
    terminal:
      settings.postProcessingEnabled && settings.terminalContourEnabled ? 1 : 0,
  };
}

function getPostEffectAmount(
  settings: EffectiveCymaticSettings,
  effectId: PostEffectId,
): number {
  return getPostEffectAmounts(settings)[effectId];
}

function isPostEffectEnabled(
  settings: EffectiveCymaticSettings,
  effectId: PostEffectId,
): boolean {
  return Boolean(
    settings.postProcessingEnabled && settings[POST_EFFECT_ENABLED_KEYS[effectId]],
  );
}

function hasActivePostEffectAmount(amounts: PostEffectAmounts): boolean {
  return Object.values(amounts).some((amount: number): boolean => amount > 0.001);
}
