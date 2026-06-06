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
  coerceTemplateTransitionConfig,
  createEffectiveCymaticSettings,
  createTemplateTransition,
  advanceTemplateTransition,
  interpolateEffectiveSettings,
} from "../src/templateTransition.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import {
  cloneCymaticSettings,
  cloneTemplateSettings,
  coerceCymaticSettings,
  createSettingsFromTemplate,
  getCycledTemplateIndex,
  type WavefieldTemplate,
} from "../src/templateSettings.ts";
import type { BoundaryMode, CymaticSettings, FieldModel } from "../src/types.ts";

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
  assert.equal(getCommandForKey(commands, bindings, "Digit4")?.id, "boundary.clamped");
  assert.equal(getCommandForKey(commands, bindings, "Digit5")?.id, "boundary.supported");

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
  const assignment = assignKeyBinding(commands, {}, commandId, "KeyG");

  assert.equal(assignment.ok, true);
  if (assignment.ok) {
    assert.equal(
      getCommandForKey(commands, assignment.bindings, "KeyG")?.id,
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

test("template transition config applies resonance changes by default", () => {
  const defaultConfig = coerceTemplateTransitionConfig({});
  const disabledConfig = coerceTemplateTransitionConfig({
    durationSeconds: 0.75,
    easing: "easeOut",
    applyBoundaryMode: false,
  });

  assert.equal(defaultConfig.applyBoundaryMode, true);
  assert.equal(disabledConfig.applyBoundaryMode, false);
  assert.equal(disabledConfig.durationSeconds, 0.75);
  assert.equal(disabledConfig.easing, "easeOut");
});

test("template transition can preserve current resonance type", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
  });
  const target: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "dirichlet",
    cymaticBrightness: 3,
  };
  const transition = createTemplateTransition(from, target, {
    durationSeconds: 1,
    easing: "linear",
    applyBoundaryMode: false,
  });
  const result = advanceTemplateTransition(transition, 1);

  assert.equal(result.settings.boundaryMode, "freePlate");
  assert.equal(result.settings.boundaryWeights.freePlate, 1);
  assert.equal(result.settings.boundaryWeights.dirichlet, 0);
  assert.equal(result.settings.cymaticBrightness, 3);
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

test("template snapshots exclude transition and derived runtime settings", () => {
  const settings = cloneTemplateSettings({
    ...DEFAULT_SETTINGS,
    durationSeconds: 4,
    easing: "linear",
    enabled: false,
    applyBoundaryMode: false,
    templateTransitionConfig: {
      durationSeconds: 4,
      easing: "linear",
      applyBoundaryMode: false,
    },
    boundaryTransitionConfig: {
      enabled: false,
      durationSeconds: 4,
      easing: "linear",
    },
    boundaryWeights: {
      freePlate: 0,
      dirichlet: 1,
      neumann: 0,
      clamped: 0,
      supported: 0,
    },
    fieldModelWeights: {
      modalPlate: 0,
      radialPlate: 1,
      faradayPulse: 0,
      spiralPhase: 0,
    },
    postEffectAmounts: {
      bloom: 1,
      pixelation: 0,
      fisheye: 0,
      alphaDecay: 0,
      terminal: 0,
    },
  });

  assert.equal("durationSeconds" in settings, false);
  assert.equal("easing" in settings, false);
  assert.equal("enabled" in settings, false);
  assert.equal("applyBoundaryMode" in settings, false);
  assert.equal("templateTransitionConfig" in settings, false);
  assert.equal("boundaryTransitionConfig" in settings, false);
  assert.equal("boundaryWeights" in settings, false);
  assert.equal("fieldModelWeights" in settings, false);
  assert.equal("postEffectAmounts" in settings, false);
});

test("settings clones exclude transition and derived runtime settings", () => {
  const settings = cloneCymaticSettings({
    ...DEFAULT_SETTINGS,
    durationSeconds: 4,
    easing: "linear",
    enabled: false,
    applyBoundaryMode: false,
    boundaryWeights: {
      freePlate: 0,
      dirichlet: 1,
      neumann: 0,
      clamped: 0,
      supported: 0,
    },
    fieldModelWeights: {
      modalPlate: 0,
      radialPlate: 1,
      faradayPulse: 0,
      spiralPhase: 0,
    },
    postEffectAmounts: {
      bloom: 1,
      pixelation: 0,
      fisheye: 0,
      alphaDecay: 0,
      terminal: 0,
    },
  });

  assert.equal("durationSeconds" in settings, false);
  assert.equal("easing" in settings, false);
  assert.equal("enabled" in settings, false);
  assert.equal("applyBoundaryMode" in settings, false);
  assert.equal("boundaryWeights" in settings, false);
  assert.equal("fieldModelWeights" in settings, false);
  assert.equal("postEffectAmounts" in settings, false);
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

test("template application ignores transition settings from raw template data", () => {
  const applied = createSettingsFromTemplate(
    {
      ...DEFAULT_SETTINGS,
      cymaticBrightness: 2,
      durationSeconds: 4,
      easing: "linear",
      enabled: false,
      applyBoundaryMode: false,
      boundaryTransitionConfig: {
        enabled: false,
        durationSeconds: 4,
        easing: "linear",
      },
    },
    DEFAULT_SETTINGS,
  );

  assert.equal(applied.cymaticBrightness, 2);
  assert.equal("durationSeconds" in applied, false);
  assert.equal("easing" in applied, false);
  assert.equal("enabled" in applied, false);
  assert.equal("applyBoundaryMode" in applied, false);
  assert.equal("boundaryTransitionConfig" in applied, false);
});

test("template settings accept all resonance styles", () => {
  const modes = [
    "freePlate",
    "dirichlet",
    "neumann",
    "clamped",
    "supported",
  ] satisfies BoundaryMode[];

  for (const boundaryMode of modes) {
    const settings = coerceCymaticSettings({
      ...DEFAULT_SETTINGS,
      boundaryMode,
    });
    assert.equal(settings.boundaryMode, boundaryMode);
  }
});

test("template settings accept all field models", () => {
  const models = [
    "modalPlate",
    "radialPlate",
    "faradayPulse",
    "spiralPhase",
  ] satisfies FieldModel[];

  for (const fieldModel of models) {
    const settings = coerceCymaticSettings({
      ...DEFAULT_SETTINGS,
      fieldModel,
    });
    assert.equal(settings.fieldModel, fieldModel);
  }
});

test("template application preserves field model from template", () => {
  const templateSettings = cloneTemplateSettings({
    ...DEFAULT_SETTINGS,
    fieldModel: "faradayPulse",
  });
  const applied = createSettingsFromTemplate(templateSettings, {
    ...DEFAULT_SETTINGS,
    fieldModel: "modalPlate",
  });

  assert.equal(applied.fieldModel, "faradayPulse");
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

test("template transition interpolates boundary and activates participating post effects", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
    postBloomEnabled: false,
    postBloomIntensity: 0.9,
  });
  const to = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "dirichlet",
    postBloomEnabled: true,
    postBloomIntensity: 0.8,
  });
  const interpolated = interpolateEffectiveSettings(from, to, 0.5);

  assert.equal(interpolated.boundaryWeights.freePlate, 0.5);
  assert.equal(interpolated.boundaryWeights.dirichlet, 0.5);
  assert.equal(interpolated.postEffectAmounts.bloom, 0.5);
  assert.equal(interpolated.postBloomEnabled, true);
  assert.equal(interpolated.postBloomIntensity, 0.4);
});

test("template transition ramps enabled post effects down to neutral values", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postBloomEnabled: true,
    postBloomIntensity: 0.8,
    postPixelationEnabled: true,
    postPixelSize: 7,
    postFisheyeEnabled: true,
    postFisheyeStrength: 0.8,
    postAlphaDecayEnabled: true,
    postAlphaDecayFrames: 80,
    terminalContourEnabled: true,
    terminalCellSize: 10,
    terminalContourLevels: 8,
    terminalContourStrength: 1,
    terminalContourThreshold: 0.1,
  });
  const to = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postBloomEnabled: false,
    postBloomIntensity: 0.4,
    postPixelationEnabled: false,
    postPixelSize: 5,
    postFisheyeEnabled: false,
    postFisheyeStrength: 0.2,
    postAlphaDecayEnabled: false,
    postAlphaDecayFrames: 24,
    terminalContourEnabled: false,
    terminalCellSize: 12,
    terminalContourLevels: 6,
    terminalContourStrength: 0.5,
    terminalContourThreshold: 0.2,
  });
  const halfway = interpolateEffectiveSettings(from, to, 0.5);
  const complete = interpolateEffectiveSettings(from, to, 1);

  assert.equal(halfway.postBloomEnabled, true);
  assert.equal(halfway.postPixelationEnabled, true);
  assert.equal(halfway.postFisheyeEnabled, true);
  assert.equal(halfway.postAlphaDecayEnabled, true);
  assert.equal(halfway.terminalContourEnabled, true);
  assert.equal(halfway.postBloomIntensity, 0.4);
  assert.equal(halfway.postPixelSize, 4);
  assert.equal(halfway.postFisheyeStrength, 0.4);
  assert.equal(halfway.postAlphaDecayFrames, 40);
  assert.equal(halfway.terminalCellSize, 5);
  assert.equal(halfway.terminalContourLevels, 4);
  assert.equal(halfway.terminalContourStrength, 0.5);
  assert.equal(halfway.terminalContourThreshold, 0.05);

  assert.equal(complete.postBloomEnabled, false);
  assert.equal(complete.postPixelationEnabled, false);
  assert.equal(complete.postFisheyeEnabled, false);
  assert.equal(complete.postAlphaDecayEnabled, false);
  assert.equal(complete.terminalContourEnabled, false);
  assert.equal(complete.postBloomIntensity, 0);
  assert.equal(complete.postPixelSize, 1);
  assert.equal(complete.postFisheyeStrength, 0);
  assert.equal(complete.postAlphaDecayFrames, 0);
  assert.equal(complete.terminalCellSize, 0);
  assert.equal(complete.terminalContourLevels, 0);
  assert.equal(complete.terminalContourStrength, 0);
  assert.equal(complete.terminalContourThreshold, 0);
});

test("template transition ramps disabled post effects up from neutral values", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postBloomEnabled: false,
    postBloomIntensity: 0.9,
    postPixelationEnabled: false,
    postPixelSize: 9,
    postFisheyeEnabled: false,
    postFisheyeStrength: 0.9,
    postAlphaDecayEnabled: false,
    postAlphaDecayFrames: 90,
    terminalContourEnabled: false,
    terminalCellSize: 14,
    terminalContourLevels: 10,
    terminalContourStrength: 1,
    terminalContourThreshold: 0.2,
  });
  const to = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postBloomEnabled: true,
    postBloomIntensity: 0.8,
    postPixelationEnabled: true,
    postPixelSize: 7,
    postFisheyeEnabled: true,
    postFisheyeStrength: 0.8,
    postAlphaDecayEnabled: true,
    postAlphaDecayFrames: 80,
    terminalContourEnabled: true,
    terminalCellSize: 10,
    terminalContourLevels: 8,
    terminalContourStrength: 1,
    terminalContourThreshold: 0.1,
  });
  const start = interpolateEffectiveSettings(from, to, 0);
  const halfway = interpolateEffectiveSettings(from, to, 0.5);

  assert.equal(start.postBloomEnabled, true);
  assert.equal(start.postPixelationEnabled, true);
  assert.equal(start.postFisheyeEnabled, true);
  assert.equal(start.postAlphaDecayEnabled, true);
  assert.equal(start.terminalContourEnabled, true);
  assert.equal(start.postBloomIntensity, 0);
  assert.equal(start.postPixelSize, 1);
  assert.equal(start.postFisheyeStrength, 0);
  assert.equal(start.postAlphaDecayFrames, 0);
  assert.equal(start.terminalCellSize, 0);
  assert.equal(start.terminalContourLevels, 0);
  assert.equal(start.terminalContourStrength, 0);
  assert.equal(start.terminalContourThreshold, 0);

  assert.equal(halfway.postBloomIntensity, 0.4);
  assert.equal(halfway.postPixelSize, 4);
  assert.equal(halfway.postFisheyeStrength, 0.4);
  assert.equal(halfway.postAlphaDecayFrames, 40);
  assert.equal(halfway.terminalCellSize, 5);
  assert.equal(halfway.terminalContourLevels, 4);
  assert.equal(halfway.terminalContourStrength, 0.5);
  assert.equal(halfway.terminalContourThreshold, 0.05);
});

test("template transition naturally lerps post effects that stay enabled", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postBloomEnabled: true,
    postBloomIntensity: 0.2,
    postPixelationEnabled: true,
    postPixelSize: 4,
  });
  const to = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    postBloomEnabled: true,
    postBloomIntensity: 0.8,
    postPixelationEnabled: true,
    postPixelSize: 8,
  });
  const halfway = interpolateEffectiveSettings(from, to, 0.5);

  assert.equal(halfway.postBloomEnabled, true);
  assert.equal(halfway.postPixelationEnabled, true);
  assert.equal(halfway.postBloomIntensity, 0.5);
  assert.equal(halfway.postPixelSize, 6);
});

test("all resonance styles produce one-hot boundary weights", () => {
  const modes = [
    "freePlate",
    "dirichlet",
    "neumann",
    "clamped",
    "supported",
  ] satisfies BoundaryMode[];

  for (const boundaryMode of modes) {
    const effective = createEffectiveCymaticSettings({
      ...DEFAULT_SETTINGS,
      boundaryMode,
    });

    for (const mode of modes) {
      assert.equal(
        effective.boundaryWeights[mode],
        mode === boundaryMode ? 1 : 0,
      );
    }
  }
});

test("all field models produce one-hot field model weights", () => {
  const models = [
    "modalPlate",
    "radialPlate",
    "faradayPulse",
    "spiralPhase",
  ] satisfies FieldModel[];

  for (const fieldModel of models) {
    const effective = createEffectiveCymaticSettings({
      ...DEFAULT_SETTINGS,
      fieldModel,
    });

    for (const model of models) {
      assert.equal(
        effective.fieldModelWeights[model],
        model === fieldModel ? 1 : 0,
      );
    }
  }
});

test("template transition interpolates field model weights", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    fieldModel: "modalPlate",
  });
  const to = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    fieldModel: "spiralPhase",
  });
  const interpolated = interpolateEffectiveSettings(from, to, 0.25);

  assert.equal(interpolated.fieldModelWeights.modalPlate, 0.75);
  assert.equal(interpolated.fieldModelWeights.spiralPhase, 0.25);
  assert.equal(interpolated.fieldModelWeights.radialPlate, 0);
  assert.equal(interpolated.fieldModelWeights.faradayPulse, 0);
});

test("boundary retargeting starts from current effective weights", () => {
  const from = createEffectiveCymaticSettings({
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
  });
  const toPinned = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "dirichlet",
  } satisfies CymaticSettings;
  const firstTransition = createTemplateTransition(from, toPinned, {
    durationSeconds: 1,
    easing: "linear",
  });
  const mid = advanceTemplateTransition(firstTransition, 0.5).settings;
  const toOpenEdge = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "neumann",
  } satisfies CymaticSettings;
  const retargetedTransition = createTemplateTransition(mid, toOpenEdge, {
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
