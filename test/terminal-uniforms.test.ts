import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { createEffectiveCymaticSettings } from "../src/effectiveSettings.ts";
import { getTerminalUniformState } from "../src/webgl/terminalUniforms.ts";

test("terminal uniforms derive amount and strength from effective settings", () => {
  const settings = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postProcessingEnabled: true,
    terminalContourEnabled: true,
    terminalCellSize: 18,
    terminalContourLevels: 7,
    terminalContourStrength: 1.6,
    terminalContourThreshold: 0.08,
  });
  settings.postEffectAmounts.terminal = 0.5;

  assert.deepEqual(getTerminalUniformState(settings), {
    params: [0.5, 18, 7, 0.08],
    strength: 0.8,
  });
});

test("terminal uniforms are neutral when the effect is disabled", () => {
  const settings = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postProcessingEnabled: true,
    terminalContourEnabled: false,
    terminalCellSize: 18,
    terminalContourLevels: 7,
    terminalContourStrength: 1.6,
    terminalContourThreshold: 0.08,
  });

  assert.deepEqual(getTerminalUniformState(settings), {
    params: [0, 18, 7, 0.08],
    strength: 0,
  });
});

test("terminal cell size scales to display pixels", () => {
  const settings = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postProcessingEnabled: true,
    terminalContourEnabled: true,
    terminalCellSize: 9,
    terminalContourLevels: 8,
    terminalContourStrength: 1,
    terminalContourThreshold: 0.09,
  });

  assert.deepEqual(getTerminalUniformState(settings, 2), {
    params: [1, 18, 8, 0.09],
    strength: 1,
  });
});
