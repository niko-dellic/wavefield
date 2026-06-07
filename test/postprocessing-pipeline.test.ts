import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const POST_PIPELINE_PATH = resolve(
  TEST_DIR,
  "../src/webgl/PostProcessingPipeline.ts",
);

test("post-processing composer uses linear half-float framebuffers", () => {
  const source = readFileSync(POST_PIPELINE_PATH, "utf8");

  assert.match(source, /frameBufferType:\s*THREE\.HalfFloatType/);
});
