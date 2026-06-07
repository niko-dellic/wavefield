import * as THREE from "three";
import {
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  PixelationEffect,
  RenderPass,
} from "postprocessing";

import {
  getActivePostEffectIds,
  getPostEffectAmount,
} from "../effectiveSettings";
import type {
  EffectiveCymaticSettings,
  PostEffectId,
} from "../types";
import { AlphaDecayPass } from "./AlphaDecayPass";
import { TerminalContourEffect } from "./TerminalContourEffect";

export type PostProcessingRenderStats = {
  activeEffects: PostEffectId[];
  rendered: boolean;
};

type StandardPostEffectId = Exclude<PostEffectId, "alphaDecay" | "fisheye">;

type ActiveStandardEffect = {
  effectId: StandardPostEffectId;
  effect: Effect;
  pass: EffectPass;
};

/** Owns postprocessing composer state, pass ordering, and transition fade amounts. */
export class PostProcessingPipeline {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private alphaDecayPass: AlphaDecayPass | null = null;
  private standardEffects: ActiveStandardEffect[] = [];
  private postPipelineKey = "";
  private alphaDecayResetKey = "";
  private currentWidth = 1;
  private currentHeight = 1;
  private lastRenderStats: PostProcessingRenderStats = {
    activeEffects: [],
    rendered: false,
  };

  /** Resizes composer targets and effect-specific buffers to match the canvas. */
  public setSize(width: number, height: number): void {
    this.currentWidth = width;
    this.currentHeight = height;
    this.composer?.setSize(width, height, false);
    for (const controller of this.standardEffects) {
      controller.pass.setSize(width, height);
    }
    this.alphaDecayPass?.setSize(width, height);
  }

  /** Clears temporal history so reset actions do not leave stale trails. */
  public requestReset(): void {
    this.alphaDecayPass?.resetHistory();
    this.alphaDecayResetKey = "";
  }

  /** Renders through the active post pipeline and returns frame stats for profiling. */
  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: EffectiveCymaticSettings,
    deltaSeconds: number,
  ): PostProcessingRenderStats {
    const enabledPostEffects = getActivePostEffectIds(settings);
    if (enabledPostEffects.length === 0) {
      this.clearPostPipeline();
      this.lastRenderStats = { activeEffects: [], rendered: false };
      return this.lastRenderStats;
    }

    this.updatePostProcessing(renderer, scene, camera, settings, enabledPostEffects);
    this.composer?.render(deltaSeconds);
    this.lastRenderStats = {
      activeEffects: enabledPostEffects,
      rendered: true,
    };
    return this.lastRenderStats;
  }

  /** Returns the most recent postprocessing activity without doing extra work. */
  public getLastRenderStats(): PostProcessingRenderStats {
    return this.lastRenderStats;
  }

  /** Releases composer resources owned by the postprocessing package. */
  public dispose(): void {
    this.disposeActivePipeline();
    this.composer?.removeAllPasses();
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
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.renderPass = new RenderPass(scene, camera);
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
    this.rebuildPostPipeline(enabledPostEffects);
    this.updateSceneAndCamera(scene, camera);
    this.updateStandardEffects(settings);
    this.alphaDecayPass?.updateSettings(
      settings,
      getPostEffectAmount(settings, "alphaDecay"),
    );
    this.resetAlphaDecayHistoryIfNeeded(settings);
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
    for (const controller of this.standardEffects) {
      controller.pass.mainCamera = camera;
      controller.pass.enabled = true;
    }
    if (this.alphaDecayPass) {
      this.alphaDecayPass.enabled = true;
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

    this.disposeActivePipeline();
    this.composer.removeAllPasses();
    this.composer.addPass(this.renderPass);

    for (const effectId of enabledPostEffects) {
      if (effectId === "alphaDecay") {
        this.alphaDecayPass = new AlphaDecayPass();
        this.alphaDecayPass.setSize(this.currentWidth, this.currentHeight);
        if (this.alphaDecayPass) {
          this.composer.addPass(this.alphaDecayPass);
        }
        continue;
      }
      if (effectId === "fisheye") {
        continue;
      }

      const controller = this.createStandardEffectController(effectId);
      this.standardEffects.push(controller);
      this.composer.addPass(controller.pass);
    }
    this.postPipelineKey = pipelineKey;
  }

  private createStandardEffectController(
    effectId: StandardPostEffectId,
  ): ActiveStandardEffect {
    if (!this.renderPass) {
      throw new Error("RenderPass must exist before creating post effects");
    }

    const effect = this.createStandardEffect(effectId);
    const pass = new EffectPass(this.renderPass.mainCamera, effect);
    pass.setSize(this.currentWidth, this.currentHeight);
    return { effectId, effect, pass };
  }

  private createStandardEffect(effectId: StandardPostEffectId): Effect {
    switch (effectId) {
      case "bloom":
        return new BloomEffect({
          intensity: 0.72,
          luminanceThreshold: 0.02,
          luminanceSmoothing: 0.18,
          mipmapBlur: true,
          radius: 0.72,
        });
      case "pixelation":
        return new PixelationEffect(6);
      case "terminal":
        return new TerminalContourEffect();
    }
  }

  private updateStandardEffects(settings: EffectiveCymaticSettings): void {
    for (const controller of this.standardEffects) {
      switch (controller.effectId) {
        case "bloom":
          if (controller.effect instanceof BloomEffect) {
            controller.effect.intensity =
              settings.postBloomIntensity * getPostEffectAmount(settings, "bloom");
          }
          break;
        case "pixelation":
          if (controller.effect instanceof PixelationEffect) {
            controller.effect.granularity = THREE.MathUtils.lerp(
              1,
              settings.postPixelSize,
              getPostEffectAmount(settings, "pixelation"),
            );
          }
          break;
        case "terminal":
          if (controller.effect instanceof TerminalContourEffect) {
            controller.effect.updateSettings(
              settings,
              getPostEffectAmount(settings, "terminal"),
            );
          }
          break;
      }
    }
  }

  private disposeActivePipeline(): void {
    for (const controller of this.standardEffects) {
      controller.pass.dispose();
    }
    this.standardEffects = [];
    this.alphaDecayPass?.dispose();
    this.alphaDecayPass = null;
  }

  private clearPostPipeline(): void {
    if (!this.composer || this.postPipelineKey === "") {
      return;
    }

    this.disposeActivePipeline();
    this.composer.removeAllPasses();
    this.postPipelineKey = "";
    this.alphaDecayResetKey = "";
  }
}
