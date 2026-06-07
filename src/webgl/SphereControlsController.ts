import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import type * as THREE from "three";

const SPHERE_ROTATION_DAMPING_FACTOR = 0.012;
const SPHERE_ZOOM_DAMPING_FACTOR = 1;

type TrackballControlsWithInternals = TrackballControls & {
  _zoomCamera: () => void;
};

/** Owns TrackballControls setup for sphere projection mode. */
export class SphereControlsController {
  private controls: TrackballControls | null = null;

  public constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Resizes the controls' internal viewport cache after canvas size changes. */
  public setSize(): void {
    this.controls?.handleResize();
  }

  /** Enables controls only for sphere mode and updates them when active. */
  public update(renderer: THREE.WebGLRenderer, enabled: boolean): void {
    const controls = this.ensureControls(renderer);
    controls.enabled = enabled;
    if (enabled) {
      controls.update();
    }
  }

  /** Releases TrackballControls DOM listeners. */
  public dispose(): void {
    this.controls?.dispose();
  }

  private ensureControls(renderer: THREE.WebGLRenderer): TrackballControls {
    if (this.controls) {
      return this.controls;
    }

    const controls = new TrackballControls(this.camera, renderer.domElement);
    controls.dynamicDampingFactor = SPHERE_ROTATION_DAMPING_FACTOR;
    useImmediateZoomDamping(controls);
    controls.noPan = true;
    controls.handleResize();
    controls.enabled = false;
    this.controls = controls;
    return controls;
  }
}

/**
 * Overrides TrackballControls' private zoom hook so wheel zoom responds
 * immediately while rotation still keeps the softer damping factor.
 */
function useImmediateZoomDamping(controls: TrackballControls): void {
  const controlsWithInternals = controls as TrackballControlsWithInternals;
  const zoomCamera = controlsWithInternals._zoomCamera.bind(controls);

  controlsWithInternals._zoomCamera = (): void => {
    const rotationDampingFactor = controls.dynamicDampingFactor;
    controls.dynamicDampingFactor = SPHERE_ZOOM_DAMPING_FACTOR;
    zoomCamera();
    controls.dynamicDampingFactor = rotationDampingFactor;
  };
}
