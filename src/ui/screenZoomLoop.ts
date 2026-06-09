import { clamp } from "../math/clamp.ts";

export const SCREEN_VIEW_MIN_SCALE = 0.05;
export const SCREEN_VIEW_MAX_SCALE = 16;
export const SCREEN_ZOOM_LOOP_FADE_SECONDS = 0.24;

const SCREEN_ZOOM_LOOP_LOG_MIN = Math.log(SCREEN_VIEW_MIN_SCALE);
const SCREEN_ZOOM_LOOP_LOG_MAX = Math.log(SCREEN_VIEW_MAX_SCALE);
const SCREEN_ZOOM_LOOP_LOG_RANGE =
  SCREEN_ZOOM_LOOP_LOG_MAX - SCREEN_ZOOM_LOOP_LOG_MIN;

export type ScreenZoomLoopDirection = -1 | 0 | 1;

export type WrappedScreenZoom = {
  scale: number;
  direction: ScreenZoomLoopDirection;
  wrapped: boolean;
};

export function wrapScreenZoomDelta(
  currentScale: number,
  logScaleDelta: number,
): WrappedScreenZoom {
  const safeCurrentScale = clamp(
    currentScale,
    SCREEN_VIEW_MIN_SCALE,
    SCREEN_VIEW_MAX_SCALE,
  );
  const direction = getZoomDirection(logScaleDelta);
  const nextLogScale = Math.log(safeCurrentScale) + logScaleDelta;

  if (
    nextLogScale >= SCREEN_ZOOM_LOOP_LOG_MIN &&
    nextLogScale <= SCREEN_ZOOM_LOOP_LOG_MAX
  ) {
    return {
      scale: Math.exp(nextLogScale),
      direction,
      wrapped: false,
    };
  }

  return {
    scale: Math.exp(wrapScreenZoomLogScale(nextLogScale)),
    direction,
    wrapped: true,
  };
}

export function getScreenZoomLoopFadeBlend(progress: number) {
  return 1 - smoothUnit(clamp(progress, 0, 1));
}

function wrapScreenZoomLogScale(logScale: number) {
  const normalized =
    ((((logScale - SCREEN_ZOOM_LOOP_LOG_MIN) % SCREEN_ZOOM_LOOP_LOG_RANGE) +
      SCREEN_ZOOM_LOOP_LOG_RANGE) %
      SCREEN_ZOOM_LOOP_LOG_RANGE) +
    SCREEN_ZOOM_LOOP_LOG_MIN;

  return normalized;
}

function getZoomDirection(logScaleDelta: number): ScreenZoomLoopDirection {
  if (logScaleDelta > 0) {
    return 1;
  }
  if (logScaleDelta < 0) {
    return -1;
  }
  return 0;
}

function smoothUnit(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
