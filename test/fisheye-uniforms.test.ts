import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { createEffectiveCymaticSettings } from "../src/effectiveSettings.ts";
import { getFisheyeUniformState } from "../src/webgl/fisheyeUniforms.ts";

test("fisheye uniform state derives lens params and transition amount", () => {
  const settings = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postProcessingEnabled: true,
    postFisheyeEnabled: true,
    postFisheyeK1: 0.25,
    postFisheyeK1Aspect: true,
    postFisheyeK2: -0.5,
    postFisheyeK2Aspect: false,
    postFisheyeStrength: 1.4,
  });
  settings.postEffectAmounts.fisheye = 0.5;

  assert.deepEqual(getFisheyeUniformState(settings), {
    params: [0.25, 1, -0.5, 0],
    strength: 0.7,
  });
});
