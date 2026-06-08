import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RENDER_PROFILER_PATH = resolve(
  TEST_DIR,
  "../src/performance/renderProfiler.ts",
);
const PROFILE_SCRIPT_PATH = resolve(
  TEST_DIR,
  "../scripts/profile-scenarios.mjs",
);
const APP_PATH = resolve(TEST_DIR, "../src/app.ts");
const MODAL_RENDERER_PATH = resolve(
  TEST_DIR,
  "../src/webgl/ModalFieldRenderer.ts",
);
const POST_PIPELINE_PATH = resolve(
  TEST_DIR,
  "../src/webgl/PostProcessingPipeline.ts",
);

test("render profiler exposes a named snapshot API without console logging", () => {
  const source = readFileSync(RENDER_PROFILER_PATH, "utf8");

  assert.match(source, /ProfileScenarioResult/);
  assert.match(source, /__wavefieldProfiler/);
  assert.match(source, /snapshot:\s*this\.snapshot/);
  assert.match(source, /createSummary\(this\.latestContext\)/);
  assert.doesNotMatch(source, /console\.(log|table|debug|info|warn|error)/);
});

test("profile controls are dev-only and reuse the app settings path", () => {
  const source = readFileSync(APP_PATH, "utf8");

  assert.match(source, /__wavefieldProfileControls/);
  assert.match(source, /applyProfileSettings/);
  assert.match(source, /handleSettingsChange\(\{\s*refreshControls:\s*false\s*\}\)/);
});

test("postprocessing sizing avoids multiplying pixel ratio twice", () => {
  const appSource = readFileSync(APP_PATH, "utf8");
  const rendererSource = readFileSync(MODAL_RENDERER_PATH, "utf8");
  const pipelineSource = readFileSync(POST_PIPELINE_PATH, "utf8");

  assert.match(
    appSource,
    /this\.modalRenderer\.setSize\(width,\s*height,\s*this\.renderer\.getPixelRatio\(\)\)/,
  );
  assert.match(rendererSource, /cssWidth\s*\*\s*pixelRatio/);
  assert.match(
    rendererSource,
    /this\.postProcessing\.setSize\(cssWidth,\s*cssHeight,\s*targetWidth,\s*targetHeight\)/,
  );
  assert.match(pipelineSource, /composer\?\.setSize\(cssWidth,\s*cssHeight,\s*false\)/);
  assert.match(pipelineSource, /pass\.setSize\(this\.currentTargetWidth,\s*this\.currentTargetHeight\)/);
});

test("profile scenario script outputs the required structured scenario set", () => {
  const output = execFileSync(
    process.execPath,
    [PROFILE_SCRIPT_PATH, "--json"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output) as {
    scenarios: Array<{ id: string; capture: string }>;
  };
  const scenarioIds = parsed.scenarios.map((scenario) => scenario.id);

  assert.deepEqual(
    [
      "screen-audio-default-post-off",
      "screen-audio-default-current-post",
      "model-modal-plate",
      "model-radial-plate",
      "model-faraday-pulse",
      "model-spiral-phase",
      "post-fisheye",
      "post-terminal",
      "post-alpha-decay",
      "post-terminal-alpha",
      "sphere-surface",
      "sphere-volume",
    ].every((id) => scenarioIds.includes(id)),
    true,
  );
  assert.equal(
    parsed.scenarios.every((scenario) =>
      scenario.capture.includes("window.__wavefieldProfiler?.snapshot"),
    ),
    true,
  );
});
