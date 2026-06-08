import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { SettingsTransitionController } from "../src/templates/settingsTransitionController.ts";
import type { WavefieldTemplate } from "../src/templateSettings.ts";
import type { CymaticSettings } from "../src/types.ts";

test("settings transition controller syncs drive mode immediately", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  const controller = new SettingsTransitionController(settings);

  settings.driveMode = "audio";
  controller.syncRuntimeSettings();

  assert.equal(controller.advance(0).settings.driveMode, "audio");
});

test("settings transition controller keeps runtime drive mode during template transitions", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  const controller = new SettingsTransitionController(settings);
  controller.startTemplateTransition(createTemplate(), {
    durationSeconds: 1,
    easing: "linear",
    applyBoundaryMode: true,
  });

  settings.driveMode = "live";
  controller.syncRuntimeSettings();

  assert.equal(controller.advance(0.25).settings.driveMode, "live");
});

test("settings transition controller morphs boundary mode changes with configured timing", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
  };
  const controller = new SettingsTransitionController(settings);
  controller.setBoundaryTransitionConfig({
    enabled: true,
    durationSeconds: 2,
    easing: "linear",
  });

  const result = controller.setBoundaryMode("supported");
  const halfway = controller.advance(1).settings;

  assert.deepEqual(result, { changed: true, morphed: true });
  assert.equal(settings.boundaryMode, "supported");
  assert.equal(halfway.boundaryWeights.freePlate, 0.5);
  assert.equal(halfway.boundaryWeights.supported, 0.5);
});

test("settings transition controller applies boundary mode immediately when morph is disabled", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
  };
  const controller = new SettingsTransitionController(settings);
  controller.setBoundaryTransitionConfig({
    enabled: false,
    durationSeconds: 2,
    easing: "linear",
  });

  const result = controller.setBoundaryMode("dirichlet");
  const effective = controller.advance(1).settings;

  assert.deepEqual(result, { changed: true, morphed: false });
  assert.equal(effective.boundaryWeights.freePlate, 0);
  assert.equal(effective.boundaryWeights.dirichlet, 1);
});

test("settings transition controller handles pre-mutated boundary settings", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    boundaryMode: "freePlate",
  };
  const controller = new SettingsTransitionController(settings);
  controller.setBoundaryTransitionConfig({
    enabled: true,
    durationSeconds: 2,
    easing: "linear",
  });

  settings.boundaryMode = "supported";
  const result = controller.setBoundaryMode("supported");
  const halfway = controller.advance(1).settings;

  assert.deepEqual(result, { changed: true, morphed: true });
  assert.equal(halfway.boundaryWeights.freePlate, 0.5);
  assert.equal(halfway.boundaryWeights.supported, 0.5);
});

test("settings transition controller applies direct field model changes immediately", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    fieldModel: "modalPlate",
  };
  const controller = new SettingsTransitionController(settings);
  controller.setBoundaryTransitionConfig({
    enabled: true,
    durationSeconds: 2,
    easing: "linear",
  });

  const result = controller.setFieldModel("spiralPhase");
  const effective = controller.advance(0).settings;

  assert.deepEqual(result, { changed: true, morphed: false });
  assert.equal(settings.fieldModel, "spiralPhase");
  assert.equal(effective.fieldModelWeights.modalPlate, 0);
  assert.equal(effective.fieldModelWeights.spiralPhase, 1);
});

test("settings transition controller syncs pre-mutated color settings", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    backgroundColor: "#000000",
  };
  const controller = new SettingsTransitionController(settings);

  settings.backgroundColor = "#2fbf3e";
  controller.resetToCurrentSettings();

  assert.equal(controller.advance(0).settings.backgroundColor, "#2fbf3e");
});

test("settings transition controller handles pre-mutated field model settings", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    fieldModel: "modalPlate",
  };
  const controller = new SettingsTransitionController(settings);

  settings.fieldModel = "faradayPulse";
  const result = controller.setFieldModel("faradayPulse");
  const effective = controller.advance(0).settings;

  assert.deepEqual(result, { changed: true, morphed: false });
  assert.equal(effective.fieldModel, "faradayPulse");
  assert.equal(effective.fieldModelWeights.modalPlate, 0);
  assert.equal(effective.fieldModelWeights.faradayPulse, 1);
});

test("template transitions do not rewrite general transition config", () => {
  setTestWindow(createLocalStorage());

  const settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  const controller = new SettingsTransitionController(settings);
  controller.setBoundaryTransitionConfig({
    enabled: false,
    durationSeconds: 2.5,
    easing: "easeOut",
  });
  const before = { ...controller.boundaryTransitionConfig };
  const templateConfig = {
    durationSeconds: 0.5,
    easing: "linear" as const,
    applyBoundaryMode: true,
  };

  controller.startTemplateTransition(
    {
      ...createTemplate(),
      settings: {
        ...DEFAULT_SETTINGS,
        boundaryMode: "supported",
        fieldModel: "faradayPulse",
        durationSeconds: 8,
        easing: "easeIn",
        enabled: true,
        applyBoundaryMode: false,
      } as WavefieldTemplate["settings"],
    },
    templateConfig,
  );

  assert.deepEqual(controller.boundaryTransitionConfig, before);
  assert.deepEqual(templateConfig, {
    durationSeconds: 0.5,
    easing: "linear",
    applyBoundaryMode: true,
  });
});

function createTemplate(): WavefieldTemplate {
  return {
    name: "Audio-looking template",
    slug: "audio-looking-template",
    settings: {
      ...DEFAULT_SETTINGS,
      driveMode: "audio",
      boundaryMode: "supported",
    },
  };
}

function setTestWindow(localStorage: Storage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

function createLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
