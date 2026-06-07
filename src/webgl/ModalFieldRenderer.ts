import * as THREE from "three";

import type { ModalFieldFrame } from "../audio/ModalField";
import type { EffectiveCymaticSettings } from "../types";
import {
  ModalFieldUniformController,
  setColorUniform,
} from "./ModalFieldUniformController";
import {
  PostProcessingPipeline,
  type PostProcessingRenderStats,
} from "./PostProcessingPipeline";
import type { ScreenViewTransform } from "./renderTypes";
import { SphereControlsController } from "./SphereControlsController";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders/modalFieldShader";

export type { ScreenViewTransform } from "./renderTypes";

export type ModalFieldRenderStats = {
  postProcessing: PostProcessingRenderStats;
  projectionMode: EffectiveCymaticSettings["projectionMode"];
};

/** Public facade for rendering Wavefield's modal field in screen or sphere projection. */
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
  private readonly uniforms = new ModalFieldUniformController();
  private readonly material = new THREE.ShaderMaterial({
    uniforms: this.uniforms.uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  private readonly sphereControls = new SphereControlsController(this.sphereCamera);
  private readonly postProcessing = new PostProcessingPipeline();
  private readonly previousClearColor = new THREE.Color();
  private elapsedSeconds = 0;

  public constructor() {
    this.screenCamera.position.z = 1;
    this.sphereCamera.position.set(0, 0, 3.7);
    this.screenMesh.frustumCulled = false;
    this.screenMesh.material = this.material;
    this.sphereMesh.material = this.material;
    this.sphereMesh.visible = false;
    this.scene.add(this.screenMesh, this.sphereMesh);
  }

  /** Resizes cameras, shader uniforms, controls, and post-processing buffers. */
  public setSize(width: number, height: number): void {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    this.uniforms.setResolution(targetWidth, targetHeight);
    this.sphereCamera.aspect = targetWidth / targetHeight;
    this.sphereCamera.updateProjectionMatrix();
    this.sphereControls.setSize();
    this.postProcessing.setSize(targetWidth, targetHeight);
  }

  /** Resets time-based shader and post-processing history state. */
  public requestReset(): void {
    this.elapsedSeconds = 0;
    this.postProcessing.requestReset();
  }

  /** Renders one frame of the modal field with the provided effective settings. */
  public render(
    renderer: THREE.WebGLRenderer,
    fieldFrame: ModalFieldFrame,
    settings: EffectiveCymaticSettings,
    screenView: ScreenViewTransform,
    deltaSeconds: number,
    isIdlePreview = false,
  ): ModalFieldRenderStats {
    this.elapsedSeconds += Math.max(0, deltaSeconds);

    const isSphere = settings.projectionMode === "sphere";
    const useTransparentBackground =
      isSphere && settings.sphereBackgroundTransparent;
    this.updateProjectionState(settings, isSphere, useTransparentBackground);
    this.sphereControls.update(renderer, isSphere);
    this.uniforms.update({
      fieldFrame,
      settings,
      screenView,
      elapsedSeconds: this.elapsedSeconds,
      isIdlePreview,
      sphereCamera: this.sphereCamera,
      sphereMesh: this.sphereMesh,
    });

    const camera = isSphere ? this.sphereCamera : this.screenCamera;
    let postProcessingStats: PostProcessingRenderStats = {
      activeEffects: [],
      rendered: false,
    };
    this.withPreservedRendererState(renderer, useTransparentBackground, (): void => {
      postProcessingStats = this.postProcessing.render(
        renderer,
        this.scene,
        camera,
        settings,
        deltaSeconds,
      );
      if (!postProcessingStats.rendered) {
        renderer.render(this.scene, camera);
      }
    });

    return {
      postProcessing: postProcessingStats,
      projectionMode: settings.projectionMode,
    };
  }

  /** Releases Three.js resources and delegated controller state. */
  public dispose(): void {
    this.sphereControls.dispose();
    this.postProcessing.dispose();
    this.material.dispose();
    this.screenMesh.geometry.dispose();
    this.sphereMesh.geometry.dispose();
  }

  private updateProjectionState(
    settings: EffectiveCymaticSettings,
    isSphere: boolean,
    useTransparentBackground: boolean,
  ): void {
    const isVolumeSphere = isSphere && settings.sphereFieldMode === "volume";
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
  }

  /** Restores renderer state after Wavefield clears and renders to the default target. */
  private withPreservedRendererState(
    renderer: THREE.WebGLRenderer,
    useTransparentBackground: boolean,
    renderFrame: () => void,
  ): void {
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
    renderFrame();

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }
}
