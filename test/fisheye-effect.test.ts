import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIELD_MODEL_FRAGMENT_PATH = resolve(
  TEST_DIR,
  "../src/webgl/shaders/fragmentFieldModels.ts",
);
const POST_PIPELINE_PATH = resolve(
  TEST_DIR,
  "../src/webgl/PostProcessingPipeline.ts",
);

test("fisheye is shader-native and does not enter the post composer", () => {
  const fieldModelSource = readFileSync(FIELD_MODEL_FRAGMENT_PATH, "utf8");
  const postPipelineSource = readFileSync(POST_PIPELINE_PATH, "utf8");

  assert.match(fieldModelSource, /vec2\s+fisheyeUv\s*\(\s*vec2\s+uv\s*\)/);
  assert.match(
    fieldModelSource,
    /plateUvFromScreen\s*\(\s*fisheyeUv\s*\(\s*uv\s*\)\s*\)/,
  );
  assert.doesNotMatch(postPipelineSource, /new\s+FisheyeEffect/);
  assert.doesNotMatch(postPipelineSource, /fisheye/i);
});
