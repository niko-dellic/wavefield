import type { CymaticSettings } from "../types";
import type { ScreenViewTransform } from "../webgl/ModalFieldRenderer";
import { clamp } from "../math/clamp";

const SCREEN_VIEW_MIN_SCALE = 0.05;
const SCREEN_VIEW_MAX_SCALE = 16;
const SCREEN_WHEEL_ZOOM_SPEED = 0.0015;
const SCREEN_PINCH_MIN_DISTANCE = 8;
const SCREEN_PAN_DAMPING = 4.5;
const SCREEN_ZOOM_DAMPING = 14;

export type ScreenViewSettings = Pick<
  CymaticSettings,
  "projectionMode" | "screenAspectMode"
>;

export class ScreenViewController {
  readonly view: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };

  private readonly target: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  private readonly touchPointers = new Map<number, ScreenPointer>();
  private readonly disposers: Array<() => void> = [];
  private panPointerId: number | null = null;
  private panButtonMask = 0;
  private lastPanPoint: PlatePoint | null = null;
  private isPointerLocked = false;
  private pinchGesture: ScreenPinchGesture | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getSettings: () => ScreenViewSettings,
  ) {}

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

  update(deltaSeconds: number) {
    if (this.getSettings().projectionMode !== "screen") {
      this.view.scale = this.target.scale;
      this.view.offsetX = this.target.offsetX;
      this.view.offsetY = this.target.offsetY;
      return;
    }

    const safeDeltaSeconds = Math.max(0, deltaSeconds);
    const panBlend = 1 - Math.exp(-SCREEN_PAN_DAMPING * safeDeltaSeconds);
    const zoomBlend = 1 - Math.exp(-SCREEN_ZOOM_DAMPING * safeDeltaSeconds);
    this.view.scale += (this.target.scale - this.view.scale) * zoomBlend;
    this.view.offsetX += (this.target.offsetX - this.view.offsetX) * panBlend;
    this.view.offsetY += (this.target.offsetY - this.view.offsetY) * panBlend;
  }

  private readonly handleWheel = (event: WheelEvent) => {
    if (this.getSettings().projectionMode !== "screen") {
      return;
    }

    event.preventDefault();
    const anchor = this.getTransformedPlatePoint(event.clientX, event.clientY);
    const deltaY = normalizeWheelDelta(event);
    const nextScale = clamp(
      this.target.scale * Math.exp(-deltaY * SCREEN_WHEEL_ZOOM_SPEED),
      SCREEN_VIEW_MIN_SCALE,
      SCREEN_VIEW_MAX_SCALE,
    );
    if (nextScale === this.target.scale) {
      return;
    }

    this.setTargetAtAnchor(nextScale, event.clientX, event.clientY, anchor);
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
      this.touchPointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      this.panPointerId = null;
      this.panButtonMask = 0;
      this.lastPanPoint =
        this.touchPointers.size === 1
          ? this.getPlatePoint(event.clientX, event.clientY)
          : null;
      this.canvas.classList.add("is-panning-screen");
      this.canvas.setPointerCapture(event.pointerId);
      if (this.touchPointers.size >= 2) {
        this.resetPinchGesture();
      }
      return;
    }

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    event.preventDefault();
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
        this.applyPinchGesture();
        return;
      }

      if (!this.lastPanPoint) {
        this.lastPanPoint = this.getPlatePoint(event.clientX, event.clientY);
        return;
      }

      const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
      this.panTarget(nextPoint, this.lastPanPoint);
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
    const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
    this.panTarget(nextPoint, this.lastPanPoint);
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
    this.panTargetByPixels(event.movementX, event.movementY);
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

  private getTransformedPlatePoint(
    clientX: number,
    clientY: number,
  ): PlatePoint {
    const platePoint = this.getPlatePoint(clientX, clientY);
    return {
      x: (platePoint.x - 0.5) / this.view.scale + 0.5 + this.view.offsetX,
      y: (platePoint.y - 0.5) / this.view.scale + 0.5 + this.view.offsetY,
    };
  }

  private setTargetAtAnchor(
    scale: number,
    clientX: number,
    clientY: number,
    anchor: PlatePoint,
  ) {
    const platePoint = this.getPlatePoint(clientX, clientY);
    this.target.scale = scale;
    this.target.offsetX = anchor.x - ((platePoint.x - 0.5) / scale + 0.5);
    this.target.offsetY = anchor.y - ((platePoint.y - 0.5) / scale + 0.5);
  }

  private panTarget(nextPoint: PlatePoint, previousPoint: PlatePoint) {
    this.target.offsetX -= (nextPoint.x - previousPoint.x) / this.target.scale;
    this.target.offsetY -= (nextPoint.y - previousPoint.y) / this.target.scale;
  }

  private panTargetByPixels(deltaX: number, deltaY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const xScale =
      this.getSettings().screenAspectMode === "circle" ? height : width;

    this.target.offsetX -= deltaX / xScale / this.target.scale;
    this.target.offsetY += deltaY / height / this.target.scale;
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
      this.canvas.requestPointerLock();
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

  private applyPinchGesture() {
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
    this.setTargetAtAnchor(
      nextScale,
      pinch.midpointX,
      pinch.midpointY,
      this.pinchGesture.anchor,
    );
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
