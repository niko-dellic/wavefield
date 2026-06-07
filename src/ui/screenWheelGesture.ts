const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LEGACY_MOUSE_WHEEL_STEP = 120;
const LEGACY_MOUSE_WHEEL_TOLERANCE = 0.01;

export type ScreenWheelGestureEvent = Pick<
  WheelEvent,
  "ctrlKey" | "deltaMode" | "deltaX" | "deltaY"
> & {
  wheelDelta?: number;
  wheelDeltaX?: number;
  wheelDeltaY?: number;
};

export type ScreenWheelGestureViewport = {
  height: number;
  width: number;
};

export type ScreenWheelGesture =
  | {
      type: "pan";
      deltaX: number;
      deltaY: number;
    }
  | {
      type: "zoom";
      source: "pinch" | "wheel";
      deltaY: number;
    };

export function getScreenWheelGesture(
  event: ScreenWheelGestureEvent,
  viewport: ScreenWheelGestureViewport,
): ScreenWheelGesture {
  if (event.ctrlKey) {
    return {
      type: "zoom",
      source: "pinch",
      deltaY: normalizeWheelDelta(event.deltaY, event.deltaMode, viewport.height),
    };
  }

  if (isCoarseMouseWheel(event)) {
    return {
      type: "zoom",
      source: "wheel",
      deltaY: normalizeWheelDelta(event.deltaY, event.deltaMode, viewport.height),
    };
  }

  return {
    type: "pan",
    deltaX: -normalizeWheelDelta(event.deltaX, event.deltaMode, viewport.width),
    deltaY: -normalizeWheelDelta(event.deltaY, event.deltaMode, viewport.height),
  };
}

function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageSize: number,
): number {
  if (deltaMode === DOM_DELTA_LINE) {
    return delta * 16;
  }

  if (deltaMode === DOM_DELTA_PAGE) {
    return delta * pageSize;
  }

  return delta;
}

function isCoarseMouseWheel(event: ScreenWheelGestureEvent): boolean {
  if (event.deltaMode === DOM_DELTA_LINE || event.deltaMode === DOM_DELTA_PAGE) {
    return true;
  }

  if (event.deltaX !== 0) {
    return false;
  }

  const legacyWheelDelta = event.wheelDeltaY ?? event.wheelDelta ?? 0;
  if (legacyWheelDelta === 0) {
    return false;
  }

  const legacySteps = Math.abs(legacyWheelDelta) / LEGACY_MOUSE_WHEEL_STEP;
  return Math.abs(legacySteps - Math.round(legacySteps)) < LEGACY_MOUSE_WHEEL_TOLERANCE;
}
