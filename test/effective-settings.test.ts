import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import {
  BOUNDARY_MODES,
  FIELD_MODELS,
  POST_EFFECT_IDS,
  createEffectiveCymaticSettings,
  getBoundaryWeights,
  getFieldModelWeights,
  getPostEffectAmounts,
  hasActivePostEffectAmount,
} from "../src/effectiveSettings.ts";
import type { BoundaryMode, FieldModel, PostEffectId } from "../src/types.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIELD_MODEL_SHADER_PATH = resolve(
  TEST_DIR,
  "../src/webgl/shaders/fragmentFieldModels.ts",
);

test("all resonance styles produce one-hot effective weights", () => {
  for (const boundaryMode of BOUNDARY_MODES) {
    const weights = getBoundaryWeights(boundaryMode);
    assert.equal(weights[boundaryMode], 1);
    for (const otherMode of BOUNDARY_MODES) {
      if (otherMode !== boundaryMode) {
        assert.equal(weights[otherMode], 0);
      }
    }
  }
});

test("all field models produce one-hot effective weights", () => {
  for (const fieldModel of FIELD_MODELS) {
    const weights = getFieldModelWeights(fieldModel);
    assert.equal(weights[fieldModel], 1);
    for (const otherModel of FIELD_MODELS) {
      if (otherModel !== fieldModel) {
        assert.equal(weights[otherModel], 0);
      }
    }
  }
});

test("effective settings centralize post-effect amounts", () => {
  const settings = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postProcessingEnabled: true,
    postBloomEnabled: true,
    postPixelationEnabled: false,
    postFisheyeEnabled: true,
    postAlphaDecayEnabled: false,
    terminalContourEnabled: true,
  });
  const expected: Record<PostEffectId, number> = {
    bloom: 1,
    pixelation: 0,
    fisheye: 1,
    alphaDecay: 0,
    terminal: 1,
  };

  assert.deepEqual(getPostEffectAmounts(settings), expected);
  assert.equal(hasActivePostEffectAmount(settings.postEffectAmounts), true);
});

test("post-effect amounts are zero when global post processing is disabled", () => {
  const settings = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postProcessingEnabled: false,
    postBloomEnabled: true,
    postPixelationEnabled: true,
    postFisheyeEnabled: true,
    postAlphaDecayEnabled: true,
    terminalContourEnabled: true,
  });

  for (const effectId of POST_EFFECT_IDS) {
    assert.equal(settings.postEffectAmounts[effectId], 0);
  }
  assert.equal(hasActivePostEffectAmount(settings.postEffectAmounts), false);
});

test("effective settings accept every model and resonance combination", () => {
  for (const fieldModel of FIELD_MODELS as readonly FieldModel[]) {
    for (const boundaryMode of BOUNDARY_MODES as readonly BoundaryMode[]) {
      const settings = createEffectiveCymaticSettings({
        ...DEFAULT_SETTINGS,
        fieldModel,
        boundaryMode,
      });
      assert.equal(settings.fieldModelWeights[fieldModel], 1);
      assert.equal(settings.boundaryWeights[boundaryMode], 1);
    }
  }
});

test("harmonic spread does not quantize through the morph amount", () => {
  const source = readFileSync(FIELD_MODEL_SHADER_PATH, "utf8");

  assert.doesNotMatch(source, /floor\([^)]*uHarmonicMix/);
});
