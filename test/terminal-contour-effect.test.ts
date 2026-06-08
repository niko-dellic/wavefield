import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TERMINAL_CONTOUR_PATH = resolve(
  TEST_DIR,
  "../src/webgl/TerminalContourEffect.ts",
);

test("terminal contour effect uses masked local contrast instead of whole-frame tint", () => {
  const source = readFileSync(TERMINAL_CONTOUR_PATH, "utf8");

  assert.match(source, /float\s+effectMask\s*=\s*clamp\(\s*glyph\s*\*\s*amount/);
  assert.match(source, /float\s+contourInk\s*=\s*clamp\(\s*mark\s*\*\s*amount/);
  assert.match(source, /localShadow\s*=\s*inputColor\.rgb\s*\*\s*\(1\.0\s*-\s*0\.28\s*\*\s*contourInk\)/);
  assert.match(
    source,
    /localHighlight\s*=\s*mix\(\s*localShadow/,
  );
  assert.match(
    source,
    /neutralAccent\s*=\s*terminalTint\s*-\s*vec3\(\s*luminance\(terminalTint\)\s*\)/,
  );
  assert.match(source, /outputColor\s*=\s*vec4\(\s*color,\s*inputColor\.a\s*\)/);
  assert.doesNotMatch(source, /inputColor\.rgb\s*\*\s*0\.2/);
  assert.doesNotMatch(source, /max\(\s*inputColor\.rgb/);
  assert.doesNotMatch(source, /mix\(\s*inputColor\.rgb\s*,\s*terminalColor/);
  assert.doesNotMatch(source, /0\.38\s*\+\s*centerLum\s*\*\s*1\.55/);
});
