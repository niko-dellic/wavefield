import assert from "node:assert/strict";
import test from "node:test";

import {
  getScreenZoomLoopFadeBlend,
  SCREEN_VIEW_MAX_SCALE,
  SCREEN_VIEW_MIN_SCALE,
  wrapScreenZoomDelta,
} from "../src/ui/screenZoomLoop.ts";

const EPSILON = 1e-10;

test("screen zoom loop keeps the current public range", () => {
  assert.equal(SCREEN_VIEW_MIN_SCALE, 0.05);
  assert.equal(SCREEN_VIEW_MAX_SCALE, 16);
});

test("zooming past max wraps to min with overshoot preserved", () => {
  const zoom = wrapScreenZoomDelta(SCREEN_VIEW_MAX_SCALE, Math.log(2));

  assert.equal(zoom.wrapped, true);
  assert.equal(zoom.direction, 1);
  assert.ok(Math.abs(zoom.scale - SCREEN_VIEW_MIN_SCALE * 2) < EPSILON);
});

test("zooming past min wraps to max with overshoot preserved", () => {
  const zoom = wrapScreenZoomDelta(SCREEN_VIEW_MIN_SCALE, -Math.log(2));

  assert.equal(zoom.wrapped, true);
  assert.equal(zoom.direction, -1);
  assert.ok(Math.abs(zoom.scale - SCREEN_VIEW_MAX_SCALE / 2) < EPSILON);
});

test("screen zoom loop fade only blends during an active wrap transition", () => {
  assert.equal(getScreenZoomLoopFadeBlend(0), 1);
  assert.ok(getScreenZoomLoopFadeBlend(0.5) > 0);
  assert.ok(getScreenZoomLoopFadeBlend(0.5) < 1);
  assert.equal(getScreenZoomLoopFadeBlend(1), 0);
  assert.equal(getScreenZoomLoopFadeBlend(2), 0);
});
