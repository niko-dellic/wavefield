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
