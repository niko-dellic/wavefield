import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TERMINAL_SHADER_PATH = resolve(
  TEST_DIR,
  "../src/webgl/shaders/fragmentTerminal.ts",
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

test("terminal contours are shader-native field markup, not a composer pass", () => {
  const terminalSource = readFileSync(TERMINAL_SHADER_PATH, "utf8");
  const modalShaderSource = readFileSync(MODAL_FIELD_SHADER_PATH, "utf8");
  const postPipelineSource = readFileSync(POST_PIPELINE_PATH, "utf8");

  assert.match(terminalSource, /vec3\s+applyTerminalOverlay\(/);
  assert.match(terminalSource, /uTerminalParams/);
  assert.match(terminalSource, /uTerminalStrength/);
  assert.match(terminalSource, /normalizedField/);
  assert.match(terminalSource, /fieldGradient/);
  assert.match(terminalSource, /nodeBand/);
  assert.match(terminalSource, /broadBand/);
  assert.match(terminalSource, /density/);
  assert.match(terminalSource, /visibleInk/);

  assert.match(modalShaderSource, /TERMINAL_FRAGMENT/);
  assert.doesNotMatch(postPipelineSource, /TerminalContourEffect/);
  assert.doesNotMatch(postPipelineSource, /case\s+"terminal"/);
});

test("terminal shader avoids whole-frame luminance compositing", () => {
  const terminalSource = readFileSync(TERMINAL_SHADER_PATH, "utf8");

  assert.doesNotMatch(terminalSource, /inputBuffer/);
  assert.doesNotMatch(terminalSource, /mainImage/);
  assert.doesNotMatch(terminalSource, /inputColor\.rgb\s*\*\s*0\.2/);
  assert.doesNotMatch(terminalSource, /mix\(\s*inputColor\.rgb/);
  assert.doesNotMatch(terminalSource, /max\(\s*inputColor\.rgb/);
});

test("terminal screen overlay is applied after background alpha blending", () => {
  const mainSource = readFileSync(MAIN_SHADER_PATH, "utf8");
  const finalMixIndex = mainSource.indexOf(
    "vec3 finalColor = mix(uBackgroundColor, litColor, alpha);",
  );
  const terminalOverlayIndex = mainSource.indexOf(
    "finalColor = applyTerminalOverlay(",
  );

  assert.notEqual(finalMixIndex, -1);
  assert.notEqual(terminalOverlayIndex, -1);
  assert.ok(terminalOverlayIndex > finalMixIndex);
});

test("terminal can draw outside ordinary visible stroke ink", () => {
  const terminalSource = readFileSync(TERMINAL_SHADER_PATH, "utf8");
  const mainSource = readFileSync(MAIN_SHADER_PATH, "utf8");

  assert.match(
    mainSource,
    /visibleInk\s*<=\s*0\.001\s*&&\s*uTerminalParams\.x\s*<=\s*0\.0001/,
  );
  assert.match(terminalSource, /float\s+fieldSurface\s*=\s*clamp/);
  assert.match(terminalSource, /broadBand\s*\*\s*0\.46/);
  assert.match(terminalSource, /float\s+gridMask\s*=/);
  assert.doesNotMatch(
    terminalSource,
    /if\s*\([^)]*visibleInk\s*<=\s*0\.0001[^)]*\)\s*\{\s*return baseColor;/,
  );
});

test("terminal surface overlay uses ink accents instead of white fill", () => {
  const terminalSource = readFileSync(TERMINAL_SHADER_PATH, "utf8");

  assert.match(terminalSource, /float\s+terminalInk\s*=/);
  assert.match(terminalSource, /vec3\s+terminalAccent\s*=/);
  assert.doesNotMatch(terminalSource, /terminalHighlight/);
  assert.doesNotMatch(terminalSource, /vec3\(\s*0\.78,\s*0\.96,\s*1\.0\s*\)/);
});
