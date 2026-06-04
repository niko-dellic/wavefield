import assert from "node:assert/strict";
import test from "node:test";

import {
  assignKeyBinding,
  buildKeyCommands,
  coerceKeyBindings,
  createTemplateApplyCommandId,
  getCommandForKey,
  getKeyboardEventCode,
} from "../src/keybindings.ts";
import { coerceBoundaryTransitionConfig } from "../src/boundaryTransition.ts";
import {
  cloneEffectiveCymaticSettings,
  createEffectiveCymaticSettings,
  createTemplateTransition,
  advanceTemplateTransition,
  interpolateEffectiveSettings,
} from "../src/templateTransition.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import {
  cloneTemplateSettings,
  createSettingsFromTemplate,
  getCycledTemplateIndex,
  type WavefieldTemplate,
} from "../src/templateSettings.ts";
import type { CymaticSettings } from "../src/types.ts";

const TEMPLATES: WavefieldTemplate[] = [
  createTemplate("alpha", "Alpha"),
  createTemplate("beta", "Beta"),
  createTemplate("gamma", "Gamma"),
];

test("keybind assignment rejects reserved command conflicts", () => {
  const commands = buildKeyCommands(TEMPLATES);
  const commandId = createTemplateApplyCommandId("alpha");
  const assignment = assignKeyBinding(commands, {}, commandId, "KeyF");

  assert.equal(assignment.ok, false);
  if (!assignment.ok) {
    assert.equal(assignment.conflictCommandId, "ui.fullscreen");
  }
});

test("boundary hotkeys are reserved defaults", () => {
  const commands = buildKeyCommands(TEMPLATES);
  const bindings = coerceKeyBindings({}, commands);

  assert.equal(getCommandForKey(commands, bindings, "Digit1")?.id, "boundary.freePlate");
  assert.equal(getCommandForKey(commands, bindings, "Digit2")?.id, "boundary.dirichlet");
  assert.equal(getCommandForKey(commands, bindings, "Digit3")?.id, "boundary.neumann");

  const commandId = createTemplateApplyCommandId("alpha");
  const assignment = assignKeyBinding(commands, bindings, commandId, "Digit1");

  assert.equal(assignment.ok, false);
  if (!assignment.ok) {
    assert.equal(assignment.conflictCommandId, "boundary.freePlate");
  }
});

test("keybind assignment resolves template command by key", () => {
  const commands = buildKeyCommands(TEMPLATES);
  const commandId = createTemplateApplyCommandId("alpha");
  const assignment = assignKeyBinding(commands, {}, commandId, "Digit4");

  assert.equal(assignment.ok, true);
  if (assignment.ok) {
    assert.equal(
      getCommandForKey(commands, assignment.bindings, "Digit4")?.id,
      commandId,
    );
  }
});

test("keyboard event code falls back to key values", () => {
  assert.equal(
    getKeyboardEventCode({ code: "", key: "ArrowRight" } as KeyboardEvent),
    "ArrowRight",
  );
  assert.equal(
    getKeyboardEventCode({ code: "", key: "f" } as KeyboardEvent),
    "KeyF",
  );
  assert.equal(
    getKeyboardEventCode({ code: "", key: "1" } as KeyboardEvent),
    "Digit1",
  );
});

test("template cycling wraps through sorted template order", () => {
  assert.equal(getCycledTemplateIndex(TEMPLATES, null, 1), 0);
  assert.equal(getCycledTemplateIndex(TEMPLATES, null, -1), 2);
  assert.equal(getCycledTemplateIndex(TEMPLATES, "gamma", 1), 0);
  assert.equal(getCycledTemplateIndex(TEMPLATES, "alpha", -1), 2);
});

test("template transition preserves drive mode", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    driveMode: "audio",
    cymaticBrightness: 1,
  });
  const target: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    driveMode: "manual",
    cymaticBrightness: 3,
  };
  const transition = createTemplateTransition(from, target, {
    durationSeconds: 1,
    easing: "linear",
  });
  const result = advanceTemplateTransition(transition, 0.5);

  assert.equal(result.settings.driveMode, "audio");
  assert.equal(result.settings.cymaticBrightness, 2);
});

test("template snapshots exclude drive mode settings", () => {
  const settings = cloneTemplateSettings({
    ...DEFAULT_SETTINGS,
    driveMode: "manual",
    testFrequency: 330,
    frequencySweep: false,
    frequencySweepRate: 0.2,
    frequencySweepRange: 2,
  });

  assert.equal("driveMode" in settings, false);
  assert.equal("testFrequency" in settings, false);
  assert.equal("frequencySweep" in settings, false);
  assert.equal("frequencySweepRate" in settings, false);
  assert.equal("frequencySweepRange" in settings, false);
});

test("template application preserves current drive mode settings", () => {
  const templateSettings = cloneTemplateSettings({
    ...DEFAULT_SETTINGS,
    frequencySweep: true,
    testFrequency: 880,
    cymaticBrightness: 2,
  });
  const currentSettings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    driveMode: "manual",
    frequencySweep: false,
    testFrequency: 110,
    frequencySweepRate: 0.1,
    frequencySweepRange: 0.5,
  };
  const applied = createSettingsFromTemplate(templateSettings, currentSettings);

  assert.equal(applied.driveMode, "manual");
  assert.equal(applied.frequencySweep, false);
  assert.equal(applied.testFrequency, 110);
  assert.equal(applied.frequencySweepRate, 0.1);
  assert.equal(applied.frequencySweepRange, 0.5);
  assert.equal(applied.cymaticBrightness, 2);
});

test("boundary transition config preserves enabled and coerces timing", () => {
  const config = coerceBoundaryTransitionConfig({
    enabled: false,
    durationSeconds: 2.5,
    easing: "easeOut",
  });

  assert.equal(config.enabled, false);
  assert.equal(config.durationSeconds, 2.5);
  assert.equal(config.easing, "easeOut");
});

test("template transition interpolates boundary and post-effect amounts", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
    postBloomEnabled: false,
  });
  const to = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "dirichlet",
    postBloomEnabled: true,
  });
  const interpolated = interpolateEffectiveSettings(from, to, 0.5);

  assert.equal(interpolated.boundaryWeights.freePlate, 0.5);
  assert.equal(interpolated.boundaryWeights.dirichlet, 0.5);
  assert.equal(interpolated.postEffectAmounts.bloom, 0.5);
  assert.equal(interpolated.postBloomEnabled, true);
});

test("boundary retargeting starts from current effective weights", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
  });
  const toDirichlet = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "dirichlet",
  } satisfies CymaticSettings;
  const firstTransition = createTemplateTransition(from, toDirichlet, {
    durationSeconds: 1,
    easing: "linear",
  });
  const mid = advanceTemplateTransition(firstTransition, 0.5).settings;
  const toNeumann = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "neumann",
  } satisfies CymaticSettings;
  const retargetedTransition = createTemplateTransition(mid, toNeumann, {
    durationSeconds: 1,
    easing: "linear",
  });
  const retargetedMid = advanceTemplateTransition(
    retargetedTransition,
    0.5,
  ).settings;

  assert.equal(retargetedTransition.from.boundaryWeights.freePlate, 0.5);
  assert.equal(retargetedTransition.from.boundaryWeights.dirichlet, 0.5);
  assert.equal(retargetedMid.boundaryWeights.freePlate, 0.25);
  assert.equal(retargetedMid.boundaryWeights.dirichlet, 0.25);
  assert.equal(retargetedMid.boundaryWeights.neumann, 0.5);
});

test("a new transition can start from current effective settings", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    cymaticOpacity: 1,
  });
  const mid = cloneEffectiveCymaticSettings({
    ...from,
    cymaticOpacity: 2,
  });
  const transition = createTemplateTransition(
    mid,
    {
      ...DEFAULT_SETTINGS,
      cymaticOpacity: 4,
    },
    { durationSeconds: 1, easing: "linear" },
  );
  const result = advanceTemplateTransition(transition, 0.5);

  assert.equal(result.settings.cymaticOpacity, 3);
});

function createTemplate(slug: string, name: string): WavefieldTemplate {
  return {
    slug,
    name,
    createdAt: "2026-06-04T00:00:00.000Z",
    settings: { ...DEFAULT_SETTINGS },
  };
}
