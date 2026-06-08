import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TERMINAL_EFFECT_PATH = resolve(
  TEST_DIR,
  "../src/webgl/TerminalContourEffect.ts",
);
const MODAL_FIELD_SHADER_PATH = resolve(
  TEST_DIR,
  "../src/webgl/shaders/modalFieldShader.ts",
);
const POST_PIPELINE_PATH = resolve(
  TEST_DIR,
  "../src/webgl/PostProcessingPipeline.ts",
);
const MAIN_SHADER_PATH = resolve(
  TEST_DIR,
  "../src/webgl/shaders/fragmentMain.ts",
);

test("terminal contours are restored as a composer postprocessing pass", () => {
  const terminalSource = readFileSync(TERMINAL_EFFECT_PATH, "utf8");
  const modalShaderSource = readFileSync(MODAL_FIELD_SHADER_PATH, "utf8");
  const postPipelineSource = readFileSync(POST_PIPELINE_PATH, "utf8");
  const mainSource = readFileSync(MAIN_SHADER_PATH, "utf8");

  assert.match(terminalSource, /class\s+TerminalContourEffect\s+extends\s+Effect/);
  assert.match(terminalSource, /inputBuffer/);
  assert.match(terminalSource, /mainImage/);
  assert.match(postPipelineSource, /import\s+\{\s*TerminalContourEffect\s*\}/);
  assert.match(postPipelineSource, /case\s+"terminal"/);
  assert.match(postPipelineSource, /new\s+TerminalContourEffect\(\)/);

  assert.doesNotMatch(modalShaderSource, /TERMINAL_FRAGMENT/);
  assert.doesNotMatch(mainSource, /applyTerminalOverlay/);
});

test("terminal effect keeps amount and visual controls as uniforms", () => {
  const terminalSource = readFileSync(TERMINAL_EFFECT_PATH, "utf8");

  assert.match(terminalSource, /uniform\s+float\s+cellSize/);
  assert.match(terminalSource, /uniform\s+float\s+contourLevels/);
  assert.match(terminalSource, /uniform\s+float\s+contourStrength/);
  assert.match(terminalSource, /uniform\s+float\s+contourThreshold/);
  assert.match(terminalSource, /uniform\s+float\s+colorPreserve/);
  assert.match(terminalSource, /uniform\s+float\s+amount/);
  assert.match(terminalSource, /outputColor\s*=\s*mix\(inputColor/);
});

test("terminal effect maps current settings into the composer pass", () => {
  const terminalSource = readFileSync(TERMINAL_EFFECT_PATH, "utf8");
  const postPipelineSource = readFileSync(POST_PIPELINE_PATH, "utf8");

  assert.match(terminalSource, /settings\.terminalCellSize/);
  assert.match(terminalSource, /settings\.terminalContourLevels/);
  assert.match(terminalSource, /settings\.terminalContourStrength/);
  assert.match(terminalSource, /settings\.terminalContourThreshold/);
  assert.match(terminalSource, /settings\.colorMode\s*===\s*"heatmap"\s*\?\s*0\.15\s*:\s*0/);
  assert.match(terminalSource, /this\.amountUniform\.value\s*=\s*amount/);
  assert.match(
    postPipelineSource,
    /controller\.effect\.updateSettings\(\s*settings,\s*getPostEffectAmount\(settings,\s*"terminal"\)/,
  );
});
