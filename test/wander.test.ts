import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WANDER_CONFIG,
  coerceWanderConfig,
  stepWanderTarget,
} from "../src/wander.ts";
import type { ScreenViewTransform } from "../src/webgl/renderTypes.ts";

test("wander config defaults both controls off", () => {
  assert.deepEqual(coerceWanderConfig({}), DEFAULT_WANDER_CONFIG);
  assert.deepEqual(coerceWanderConfig(null), DEFAULT_WANDER_CONFIG);
});

test("wander config accepts only boolean toggles", () => {
  assert.deepEqual(
    coerceWanderConfig({
      panEnabled: true,
      depthEnabled: false,
      rotateEnabled: true,
      panSpeed: 1.5,
      depthSpeed: 0.5,
      rotateSpeed: 2,
      minDepth: 0.75,
      maxDepth: 1.5,
      resumeDelaySeconds: 2.5,
      panDamping: 2.5,
      zoomDamping: 8,
    }),
    {
      enabled: true,
      panEnabled: true,
      depthEnabled: false,
      rotateEnabled: true,
      panSpeed: 1.5,
      depthSpeed: 0.5,
      rotateSpeed: 2,
      minDepth: 0.75,
      maxDepth: 1.5,
      resumeDelaySeconds: 2.5,
      panDamping: 2.5,
      zoomDamping: 8,
    },
  );
  assert.deepEqual(
    coerceWanderConfig({
      panEnabled: "true",
      depthEnabled: 1,
      rotateEnabled: null,
      panSpeed: Number.NaN,
      depthSpeed: "1",
      rotateSpeed: Infinity,
      resumeDelaySeconds: "2",
      panDamping: null,
      zoomDamping: Number.NaN,
    }),
    DEFAULT_WANDER_CONFIG,
  );
});

test("wander config clamps numeric controls and keeps depth bounds ordered", () => {
  assert.deepEqual(
    coerceWanderConfig({
      panSpeed: -1,
      depthSpeed: 5,
      rotateSpeed: 4,
      minDepth: 20,
      maxDepth: 0.1,
      resumeDelaySeconds: 12,
      panDamping: 0,
      zoomDamping: 40,
    }),
    {
      ...DEFAULT_WANDER_CONFIG,
      panSpeed: 0,
      depthSpeed: 5,
      rotateSpeed: 4,
      minDepth: 16,
      maxDepth: 16,
      resumeDelaySeconds: 10,
      panDamping: 0.1,
      zoomDamping: 30,
    },
  );
});

test("pan wander moves the target offset without changing scale", () => {
  const target: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };

  stepWanderTarget(
    target,
    { ...DEFAULT_WANDER_CONFIG, enabled: true, panEnabled: true },
    3,
    1,
    { minScale: 0.05, maxScale: 16 },
  );

  assert.notEqual(target.offsetX, 0);
  assert.notEqual(target.offsetY, 0);
  assert.equal(target.scale, 1);
  assert.equal(target.rotation, 0);
});

test("depth wander changes scale within supplied clamps", () => {
  const target: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };

  stepWanderTarget(
    target,
    {
      ...DEFAULT_WANDER_CONFIG,
      enabled: true,
      depthEnabled: true,
      minDepth: 0.99,
      maxDepth: 1.01,
    },
    3,
    1,
    { minScale: 0.99, maxScale: 1.01 },
  );

  assert.notEqual(target.scale, 1);
  assert.ok(target.scale >= 0.99);
  assert.ok(target.scale <= 1.01);
  assert.equal(target.offsetX, 0);
  assert.equal(target.offsetY, 0);
  assert.equal(target.rotation, 0);
});

test("rotate wander changes rotation without panning or changing scale", () => {
  const target: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };

  stepWanderTarget(
    target,
    { ...DEFAULT_WANDER_CONFIG, enabled: true, rotateEnabled: true },
    3,
    1,
    { minScale: 0.05, maxScale: 16 },
  );

  assert.notEqual(target.rotation, 0);
  assert.equal(target.scale, 1);
  assert.equal(target.offsetX, 0);
  assert.equal(target.offsetY, 0);
});

test("disabled wander master leaves enabled axes idle", () => {
  const target: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  };

  stepWanderTarget(
    target,
    {
      ...DEFAULT_WANDER_CONFIG,
      enabled: false,
      panEnabled: true,
      depthEnabled: true,
      rotateEnabled: true,
    },
    3,
    1,
    { minScale: 0.05, maxScale: 16 },
  );

  assert.deepEqual(target, {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  });
});
