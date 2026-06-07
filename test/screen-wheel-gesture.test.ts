import assert from "node:assert/strict";
import test from "node:test";

import { getScreenWheelGesture } from "../src/ui/screenWheelGesture.ts";

test("trackpad sweep gestures pan in both screen axes", () => {
  assert.deepEqual(
    getScreenWheelGesture(
      {
        ctrlKey: false,
        deltaMode: 0,
        deltaX: 80,
        deltaY: 40,
      },
      { height: 600, width: 800 },
    ),
    {
      type: "pan",
      deltaX: -80,
      deltaY: -40,
    },
  );
});

test("line-mode mouse wheel gestures zoom", () => {
  assert.deepEqual(
    getScreenWheelGesture(
      {
        ctrlKey: false,
        deltaMode: 1,
        deltaX: 0,
        deltaY: 3,
      },
      { height: 600, width: 800 },
    ),
    {
      type: "zoom",
      source: "wheel",
      deltaY: 48,
    },
  );
});

test("legacy step mouse wheel gestures zoom", () => {
  assert.deepEqual(
    getScreenWheelGesture(
      {
        ctrlKey: false,
        deltaMode: 0,
        deltaX: 0,
        deltaY: 100,
        wheelDeltaY: -120,
      },
      { height: 600, width: 800 },
    ),
    {
      type: "zoom",
      source: "wheel",
      deltaY: 100,
    },
  );
});

test("pinch-style wheel gestures zoom instead of panning", () => {
  assert.deepEqual(
    getScreenWheelGesture(
      {
        ctrlKey: true,
        deltaMode: 0,
        deltaX: 80,
        deltaY: 40,
      },
      { height: 600, width: 800 },
    ),
    {
      type: "zoom",
      source: "pinch",
      deltaY: 40,
    },
  );
});

test("trackpad pixel deltas pan one-to-one", () => {
  assert.deepEqual(
    getScreenWheelGesture(
      {
        ctrlKey: false,
        deltaMode: 0,
        deltaX: 1,
        deltaY: -1,
      },
      { height: 600, width: 800 },
    ),
    {
      type: "pan",
      deltaX: -1,
      deltaY: 1,
    },
  );
});

test("page-mode mouse wheel gestures normalize as zoom", () => {
  assert.deepEqual(
    getScreenWheelGesture(
      {
        ctrlKey: false,
        deltaMode: 2,
        deltaX: 0,
        deltaY: -1,
      },
      { height: 600, width: 800 },
    ),
    {
      type: "zoom",
      source: "wheel",
      deltaY: -600,
    },
  );
});
