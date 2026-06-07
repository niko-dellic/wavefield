import type { CymaticSettings } from "../types";
import type { ScreenViewTransform } from "../webgl/ModalFieldRenderer";
import { clamp } from "../math/clamp";
import {
  DEFAULT_WANDER_CONFIG,
  stepWanderTarget,
  type WanderConfig,
} from "../wander";

const SCREEN_VIEW_MIN_SCALE = 0.05;
const SCREEN_VIEW_MAX_SCALE = 16;
const SCREEN_WHEEL_ZOOM_SPEED = 0.0015;
const SCREEN_PINCH_MIN_DISTANCE = 8;
const SCREEN_INPUT_DEFAULT_DELTA_SECONDS = 1 / 60;
const SCREEN_INPUT_MAX_DELTA_SECONDS = 0.1;
const SCREEN_INPUT_MIN_PAN_SPEED = 0.00001;
const SCREEN_INPUT_MIN_ZOOM_SPEED = 0.001;

export type ScreenViewSettings = Pick<
  CymaticSettings,
  "projectionMode" | "screenAspectMode"
>;

export type ScreenViewPosition = {
  x: number;
  y: number;
  z: number;
  rotation: number;
};

type WanderAxis = "pan" | "depth" | "rotate";
type WanderIdleSeconds = Record<WanderAxis, number>;
const WANDER_AXES = ["pan", "depth", "rotate"] satisfies WanderAxis[];

export class ScreenViewController {
  readonly view: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };

  private readonly target: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };
  private readonly touchPointers = new Map<number, ScreenPointer>();
  private readonly disposers: Array<() => void> = [];
  private panPointerId: number | null = null;
  private panButtonMask = 0;
  private lastPanPoint: PlatePoint | null = null;
  private isPointerLocked = false;
  private pinchGesture: ScreenPinchGesture | null = null;
  private wanderConfig: WanderConfig = { ...DEFAULT_WANDER_CONFIG };
  private wanderSeconds = 0;
  private wanderIdleSeconds = createWanderIdleSeconds(
    DEFAULT_WANDER_CONFIG.resumeDelaySeconds,
  );
  private panVelocityX = 0;
  private panVelocityY = 0;
  private lastPanInputTimeStamp: number | null = null;
  private zoomVelocity = 0;
  private lastZoomInputTimeStamp: number | null = null;
  private zoomInertiaAnchor: ScreenZoomAnchor | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getSettings: () => ScreenViewSettings,
    wanderConfig?: WanderConfig,
  ) {
    if (wanderConfig) {
      this.setWanderConfig(wanderConfig);
    }
  }

  bind() {
    this.addEventListener(this.canvas, "wheel", this.handleWheel, {
      passive: false,
    });
    this.addEventListener(this.canvas, "pointerdown", this.handlePointerDown);
    this.addEventListener(this.canvas, "pointermove", this.handlePointerMove);
    this.addEventListener(this.canvas, "pointerup", this.handlePointerUp);
    this.addEventListener(this.canvas, "pointercancel", this.handlePointerUp);
    this.addEventListener(this.canvas, "contextmenu", this.handleContextMenu);
    this.addDocumentListener(
      "mousemove",
      this.handlePointerLockedMouseMove,
    );
    this.addDocumentListener("mouseup", this.handlePointerLockedMouseUp);
    this.addDocumentListener("pointerlockchange", this.handlePointerLockChange);
    this.addDocumentListener("pointerlockerror", this.handlePointerLockError);
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.releasePointerLock();
  }

  endPan() {
    this.endMousePan();
  }

  setWanderConfig(config: WanderConfig) {
    this.wanderConfig = { ...config };
    this.wanderIdleSeconds = createWanderIdleSeconds(
      this.wanderConfig.resumeDelaySeconds,
    );
  }

  getWanderPosition(): ScreenViewPosition {
    return {
      x: this.target.offsetX,
      y: this.target.offsetY,
      z: this.target.scale,
      rotation: this.target.rotation,
    };
  }

  setWanderPosition(position: ScreenViewPosition) {
    const nextX = coerceFiniteNumber(position.x, this.target.offsetX);
    const nextY = coerceFiniteNumber(position.y, this.target.offsetY);
    const nextZ = clamp(
      coerceFiniteNumber(position.z, this.target.scale),
      SCREEN_VIEW_MIN_SCALE,
      SCREEN_VIEW_MAX_SCALE,
    );
    const nextRotation = coerceFiniteNumber(
      position.rotation,
      this.target.rotation,
    );

    if (nextX !== this.target.offsetX || nextY !== this.target.offsetY) {
      this.pauseWanderAxis("pan");
    }
    if (nextZ !== this.target.scale) {
      this.pauseWanderAxis("depth");
    }
    if (nextRotation !== this.target.rotation) {
      this.pauseWanderAxis("rotate");
    }

    this.target.offsetX = nextX;
    this.target.offsetY = nextY;
    this.target.scale = nextZ;
    this.target.rotation = nextRotation;
    this.clearPanInertia();
    this.clearZoomInertia();
    Object.assign(this.view, this.target);
  }

  update(deltaSeconds: number) {
    if (this.getSettings().projectionMode !== "screen") {
      this.view.scale = this.target.scale;
      this.view.offsetX = this.target.offsetX;
      this.view.offsetY = this.target.offsetY;
      this.view.rotation = this.target.rotation;
      return;
    }

    const safeDeltaSeconds = Math.max(0, deltaSeconds);
    this.applyInputInertia(safeDeltaSeconds);
    this.updateWander(safeDeltaSeconds);
    const panBlend =
      1 - Math.exp(-this.wanderConfig.panDamping * safeDeltaSeconds);
    const zoomBlend =
      1 - Math.exp(-this.wanderConfig.zoomDamping * safeDeltaSeconds);
    this.view.scale += (this.target.scale - this.view.scale) * zoomBlend;
    this.view.offsetX += (this.target.offsetX - this.view.offsetX) * panBlend;
    this.view.offsetY += (this.target.offsetY - this.view.offsetY) * panBlend;
    this.view.rotation +=
      (this.target.rotation - this.view.rotation) * panBlend;
  }

  private readonly handleWheel = (event: WheelEvent) => {
    if (this.getSettings().projectionMode !== "screen") {
      return;
    }

    event.preventDefault();
    this.pauseWanderAxis("depth");
    const anchor = this.getTransformedPlatePoint(event.clientX, event.clientY);
    const deltaY = normalizeWheelDelta(event);
    const previousScale = this.target.scale;
    const nextScale = clamp(
      previousScale * Math.exp(-deltaY * SCREEN_WHEEL_ZOOM_SPEED),
      SCREEN_VIEW_MIN_SCALE,
      SCREEN_VIEW_MAX_SCALE,
    );
    if (nextScale === this.target.scale) {
      return;
    }

    this.setTargetAtAnchor(nextScale, event.clientX, event.clientY, anchor);
    this.recordZoomInput(
      Math.log(nextScale / previousScale),
      event.timeStamp,
      {
        anchor,
        clientX: event.clientX,
        clientY: event.clientY,
      },
    );
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (this.getSettings().projectionMode !== "screen") {
      return;
    }

    if (event.pointerType === "touch") {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      this.clearPanInertia();
      this.touchPointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (this.touchPointers.size >= 2) {
        this.pauseWanderAxis("depth");
      } else {
        this.pauseWanderAxis("pan");
      }
      this.panPointerId = null;
      this.panButtonMask = 0;
      this.lastPanPoint =
        this.touchPointers.size === 1
          ? this.getPlatePoint(event.clientX, event.clientY)
          : null;
      this.canvas.classList.add("is-panning-screen");
      this.canvas.setPointerCapture(event.pointerId);
      if (this.touchPointers.size >= 2) {
        this.clearZoomInertia();
        this.resetPinchGesture();
      }
      return;
    }

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    event.preventDefault();
    this.clearPanInertia();
    this.pauseWanderAxis("pan");
    this.panPointerId = event.pointerId;
    this.panButtonMask = event.button === 2 ? 2 : 1;
    this.lastPanPoint = this.getPlatePoint(event.clientX, event.clientY);
    this.canvas.classList.add("is-panning-screen");
    this.canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") {
      this.requestPointerLock();
    }
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (
        this.getSettings().projectionMode !== "screen" ||
        !this.touchPointers.has(event.pointerId)
      ) {
        return;
      }

      event.preventDefault();
      this.touchPointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (this.touchPointers.size >= 2) {
        this.pauseWanderAxis("depth");
        this.applyPinchGesture(event.timeStamp);
        return;
      }

      this.pauseWanderAxis("pan");
      if (!this.lastPanPoint) {
        this.lastPanPoint = this.getPlatePoint(event.clientX, event.clientY);
        return;
      }

      const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
      this.panTarget(nextPoint, this.lastPanPoint, event.timeStamp);
      this.lastPanPoint = nextPoint;
      return;
    }

    if (
      this.getSettings().projectionMode !== "screen" ||
      this.isPointerLocked ||
      this.panPointerId !== event.pointerId ||
      !this.lastPanPoint ||
      (event.buttons & this.panButtonMask) === 0
    ) {
      return;
    }

    event.preventDefault();
    this.pauseWanderAxis("pan");
    const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
    this.panTarget(nextPoint, this.lastPanPoint, event.timeStamp);
    this.lastPanPoint = nextPoint;
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (!this.touchPointers.has(event.pointerId)) {
        return;
      }

      this.touchPointers.delete(event.pointerId);
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }

      if (this.touchPointers.size >= 2) {
        this.resetPinchGesture();
        return;
      }

      this.pinchGesture = null;
      const remainingTouch = this.touchPointers.values().next().value;
      this.lastPanPoint = remainingTouch
        ? this.getPlatePoint(remainingTouch.clientX, remainingTouch.clientY)
        : null;
      if (!remainingTouch) {
        this.canvas.classList.remove("is-panning-screen");
      }
      return;
    }

    if (this.panPointerId !== event.pointerId) {
      return;
    }

    this.panPointerId = null;
    this.panButtonMask = 0;
    this.lastPanPoint = null;
    this.canvas.classList.remove("is-panning-screen");
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.releasePointerLock();
  };

  private readonly handlePointerLockedMouseMove = (event: MouseEvent) => {
    if (
      this.getSettings().projectionMode !== "screen" ||
      !this.isPointerLocked ||
      this.panButtonMask === 0 ||
      (event.buttons & this.panButtonMask) === 0
    ) {
      return;
    }

    event.preventDefault();
    this.pauseWanderAxis("pan");
    this.panTargetByPixels(event.movementX, event.movementY, event.timeStamp);
  };

  private readonly handlePointerLockedMouseUp = () => {
    if (!this.isPointerLocked) {
      return;
    }

    this.endMousePan();
  };

  private readonly handlePointerLockChange = () => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
    if (this.isPointerLocked) {
      this.lastPanPoint = null;
      return;
    }

    if (this.panPointerId !== null && this.panButtonMask !== 0) {
      this.endMousePan();
    }
  };

  private readonly handlePointerLockError = () => {
    this.isPointerLocked = false;
  };

  private readonly handleContextMenu = (event: MouseEvent) => {
    if (this.getSettings().projectionMode === "screen") {
      event.preventDefault();
    }
  };

  private updateWander(deltaSeconds: number) {
    if (
      !this.wanderConfig.enabled ||
      (!this.wanderConfig.panEnabled &&
        !this.wanderConfig.depthEnabled &&
        !this.wanderConfig.rotateEnabled)
    ) {
      return;
    }

    this.wanderSeconds += deltaSeconds;

    const resumeDelaySeconds = Math.max(0, this.wanderConfig.resumeDelaySeconds);
    this.advanceWanderIdleTimers(deltaSeconds, resumeDelaySeconds);

    stepWanderTarget(
      this.target,
      {
        ...this.wanderConfig,
        panEnabled:
          this.wanderConfig.panEnabled &&
          this.isWanderAxisReady("pan", resumeDelaySeconds),
        depthEnabled:
          this.wanderConfig.depthEnabled &&
          this.isWanderAxisReady("depth", resumeDelaySeconds),
        rotateEnabled:
          this.wanderConfig.rotateEnabled &&
          this.isWanderAxisReady("rotate", resumeDelaySeconds),
      },
      this.wanderSeconds,
      deltaSeconds,
      {
        minScale: SCREEN_VIEW_MIN_SCALE,
        maxScale: SCREEN_VIEW_MAX_SCALE,
      },
    );
  }

  private pauseWanderAxis(axis: WanderAxis) {
    this.wanderIdleSeconds[axis] = 0;
  }

  private advanceWanderIdleTimers(
    deltaSeconds: number,
    resumeDelaySeconds: number,
  ) {
    for (const axis of WANDER_AXES) {
      this.wanderIdleSeconds[axis] = Math.min(
        resumeDelaySeconds,
        this.wanderIdleSeconds[axis] + deltaSeconds,
      );
    }
  }

  private isWanderAxisReady(axis: WanderAxis, resumeDelaySeconds: number) {
    if (this.wanderIdleSeconds[axis] < resumeDelaySeconds) {
      return false;
    }

    if (axis === "pan") {
      return !this.hasActivePanGesture();
    }
    if (axis === "depth") {
      return !this.hasActiveDepthGesture();
    }

    return true;
  }

  private hasActivePanGesture() {
    return (
      this.panPointerId !== null ||
      this.panButtonMask !== 0 ||
      this.isPointerLocked ||
      this.touchPointers.size === 1 ||
      this.hasPanInertia()
    );
  }

  private hasActiveDepthGesture() {
    return (
      this.touchPointers.size >= 2 ||
      this.pinchGesture !== null ||
      this.hasZoomInertia()
    );
  }

  private applyInputInertia(deltaSeconds: number) {
    if (deltaSeconds === 0) {
      return;
    }

    const panDecay = Math.exp(-this.wanderConfig.panDamping * deltaSeconds);
    if (!this.hasDirectPanInput() && this.hasPanInertia()) {
      this.target.offsetX += this.panVelocityX * deltaSeconds;
      this.target.offsetY += this.panVelocityY * deltaSeconds;
      this.panVelocityX *= panDecay;
      this.panVelocityY *= panDecay;
      if (!this.hasPanInertia()) {
        this.clearPanInertia();
      }
    }

    const zoomDecay = Math.exp(-this.wanderConfig.zoomDamping * deltaSeconds);
    if (!this.hasDirectDepthInput() && this.hasZoomInertia()) {
      const anchor = this.zoomInertiaAnchor;
      const previousScale = this.target.scale;
      const nextScale = clamp(
        previousScale * Math.exp(this.zoomVelocity * deltaSeconds),
        SCREEN_VIEW_MIN_SCALE,
        SCREEN_VIEW_MAX_SCALE,
      );
      if (anchor && nextScale !== previousScale) {
        this.setTargetAtAnchor(
          nextScale,
          anchor.clientX,
          anchor.clientY,
          anchor.anchor,
        );
      }
      this.zoomVelocity *= zoomDecay;
      if (!this.hasZoomInertia()) {
        this.clearZoomInertia();
      }
    }
  }

  private hasDirectPanInput() {
    return (
      this.panPointerId !== null ||
      this.panButtonMask !== 0 ||
      this.isPointerLocked ||
      this.touchPointers.size === 1
    );
  }

  private hasDirectDepthInput() {
    return this.touchPointers.size >= 2 || this.pinchGesture !== null;
  }

  private hasPanInertia() {
    return (
      Math.hypot(this.panVelocityX, this.panVelocityY) >
      SCREEN_INPUT_MIN_PAN_SPEED
    );
  }

  private hasZoomInertia() {
    return (
      this.zoomInertiaAnchor !== null &&
      Math.abs(this.zoomVelocity) > SCREEN_INPUT_MIN_ZOOM_SPEED
    );
  }

  private getTransformedPlatePoint(
    clientX: number,
    clientY: number,
  ): PlatePoint {
    const platePoint = this.getPlatePoint(clientX, clientY);
    const rotatedPoint = this.rotatePlateDelta(
      platePoint.x - 0.5,
      platePoint.y - 0.5,
      this.view.rotation,
    );
    return {
      x: rotatedPoint.x / this.view.scale + 0.5 + this.view.offsetX,
      y: rotatedPoint.y / this.view.scale + 0.5 + this.view.offsetY,
    };
  }

  private setTargetAtAnchor(
    scale: number,
    clientX: number,
    clientY: number,
    anchor: PlatePoint,
  ) {
    const platePoint = this.getPlatePoint(clientX, clientY);
    const rotatedPoint = this.rotatePlateDelta(
      platePoint.x - 0.5,
      platePoint.y - 0.5,
      this.target.rotation,
    );
    this.target.scale = scale;
    this.target.offsetX = anchor.x - (rotatedPoint.x / scale + 0.5);
    this.target.offsetY = anchor.y - (rotatedPoint.y / scale + 0.5);
  }

  private panTarget(
    nextPoint: PlatePoint,
    previousPoint: PlatePoint,
    timeStamp: number,
  ) {
    this.panTargetByPlateDelta(
      nextPoint.x - previousPoint.x,
      nextPoint.y - previousPoint.y,
      timeStamp,
    );
  }

  private panTargetByPixels(deltaX: number, deltaY: number, timeStamp: number) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const xScale =
      this.getSettings().screenAspectMode === "circle" ? height : width;

    this.panTargetByPlateDelta(deltaX / xScale, -deltaY / height, timeStamp);
  }

  private panTargetByPlateDelta(
    deltaX: number,
    deltaY: number,
    timeStamp: number | null,
  ) {
    const rotatedDelta = this.rotatePlateDelta(
      deltaX,
      deltaY,
      this.target.rotation,
    );
    const offsetDeltaX = -rotatedDelta.x / this.target.scale;
    const offsetDeltaY = -rotatedDelta.y / this.target.scale;
    this.target.offsetX += offsetDeltaX;
    this.target.offsetY += offsetDeltaY;
    if (timeStamp !== null) {
      this.recordPanInput(offsetDeltaX, offsetDeltaY, timeStamp);
    }
  }

  private recordPanInput(
    offsetDeltaX: number,
    offsetDeltaY: number,
    timeStamp: number,
  ) {
    const deltaSeconds = getInputDeltaSeconds(
      timeStamp,
      this.lastPanInputTimeStamp,
    );
    this.lastPanInputTimeStamp = timeStamp;
    this.panVelocityX = offsetDeltaX / deltaSeconds;
    this.panVelocityY = offsetDeltaY / deltaSeconds;
  }

  private clearPanInertia() {
    this.panVelocityX = 0;
    this.panVelocityY = 0;
    this.lastPanInputTimeStamp = null;
  }

  private recordZoomInput(
    logScaleDelta: number,
    timeStamp: number,
    anchor: ScreenZoomAnchor,
  ) {
    const deltaSeconds = getInputDeltaSeconds(
      timeStamp,
      this.lastZoomInputTimeStamp,
    );
    this.lastZoomInputTimeStamp = timeStamp;
    this.zoomVelocity = logScaleDelta / deltaSeconds;
    this.zoomInertiaAnchor = anchor;
  }

  private clearZoomInertia() {
    this.zoomVelocity = 0;
    this.lastZoomInputTimeStamp = null;
    this.zoomInertiaAnchor = null;
  }

  private rotatePlateDelta(
    deltaX: number,
    deltaY: number,
    rotation: number,
  ): PlatePoint {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    return {
      x: c * deltaX + s * deltaY,
      y: -s * deltaX + c * deltaY,
    };
  }

  private requestPointerLock() {
    if (typeof this.canvas.requestPointerLock !== "function") {
      this.isPointerLocked = false;
      return;
    }

    if (document.pointerLockElement === this.canvas) {
      this.isPointerLocked = true;
      return;
    }

    try {
      const request = this.canvas.requestPointerLock();
      if (request && typeof request.catch === "function") {
        request.catch(() => {
          this.isPointerLocked = false;
        });
      }
    } catch {
      this.isPointerLocked = false;
    }
  }

  private releasePointerLock() {
    if (
      document.pointerLockElement === this.canvas &&
      typeof document.exitPointerLock === "function"
    ) {
      document.exitPointerLock();
    }
    this.isPointerLocked = false;
  }

  private endMousePan() {
    const pointerId = this.panPointerId;
    this.panPointerId = null;
    this.panButtonMask = 0;
    this.lastPanPoint = null;
    this.canvas.classList.remove("is-panning-screen");
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.releasePointerLock();
  }

  private resetPinchGesture() {
    const pinch = this.getPinchSnapshot();
    if (!pinch) {
      this.pinchGesture = null;
      return;
    }

    this.pinchGesture = {
      distance: pinch.distance,
      scale: this.target.scale,
      anchor: this.getTransformedPlatePoint(pinch.midpointX, pinch.midpointY),
    };
  }

  private applyPinchGesture(timeStamp: number) {
    const pinch = this.getPinchSnapshot();
    if (!pinch) {
      return;
    }

    if (!this.pinchGesture) {
      this.resetPinchGesture();
      return;
    }

    const nextScale = clamp(
      this.pinchGesture.scale * (pinch.distance / this.pinchGesture.distance),
      SCREEN_VIEW_MIN_SCALE,
      SCREEN_VIEW_MAX_SCALE,
    );
    const previousScale = this.target.scale;
    this.setTargetAtAnchor(
      nextScale,
      pinch.midpointX,
      pinch.midpointY,
      this.pinchGesture.anchor,
    );
    if (nextScale !== previousScale) {
      this.recordZoomInput(
        Math.log(nextScale / previousScale),
        timeStamp,
        {
          anchor: this.pinchGesture.anchor,
          clientX: pinch.midpointX,
          clientY: pinch.midpointY,
        },
      );
    }
  }

  private getPinchSnapshot(): ScreenPinchSnapshot | null {
    const pointers = Array.from(this.touchPointers.values());
    if (pointers.length < 2) {
      return null;
    }

    const [first, second] = pointers;
    const deltaX = second.clientX - first.clientX;
    const deltaY = second.clientY - first.clientY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < SCREEN_PINCH_MIN_DISTANCE) {
      return null;
    }

    return {
      distance,
      midpointX: (first.clientX + second.clientX) * 0.5,
      midpointY: (first.clientY + second.clientY) * 0.5,
    };
  }

  private getPlatePoint(clientX: number, clientY: number): PlatePoint {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const uvX = (clientX - rect.left) / width;
    const uvY = 1 - (clientY - rect.top) / height;

    if (this.getSettings().screenAspectMode === "circle") {
      const aspect = width / height;
      return {
        x: (uvX - 0.5) * aspect + 0.5,
        y: uvY,
      };
    }

    return { x: uvX, y: uvY };
  }

  private addEventListener<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, listener, options);
    this.disposers.push(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  private addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ) {
    document.addEventListener(type, listener);
    this.disposers.push(() => {
      document.removeEventListener(type, listener);
    });
  }
}

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === event.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === event.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }

  return event.deltaY;
}

function coerceFiniteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function getInputDeltaSeconds(timeStamp: number, lastTimeStamp: number | null) {
  if (lastTimeStamp === null || timeStamp <= lastTimeStamp) {
    return SCREEN_INPUT_DEFAULT_DELTA_SECONDS;
  }

  return clamp(
    (timeStamp - lastTimeStamp) / 1_000,
    SCREEN_INPUT_DEFAULT_DELTA_SECONDS,
    SCREEN_INPUT_MAX_DELTA_SECONDS,
  );
}

function createWanderIdleSeconds(seconds: number): WanderIdleSeconds {
  return {
    pan: seconds,
    depth: seconds,
    rotate: seconds,
  };
}

type PlatePoint = {
  x: number;
  y: number;
};

type ScreenPointer = {
  clientX: number;
  clientY: number;
};

type ScreenPinchGesture = {
  distance: number;
  scale: number;
  anchor: PlatePoint;
};

type ScreenPinchSnapshot = {
  distance: number;
  midpointX: number;
  midpointY: number;
};

type ScreenZoomAnchor = {
  anchor: PlatePoint;
  clientX: number;
  clientY: number;
};
