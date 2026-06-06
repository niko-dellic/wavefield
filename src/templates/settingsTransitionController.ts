import {
  BOUNDARY_TRANSITION_STORAGE_KEY,
  DEFAULT_BOUNDARY_TRANSITION_CONFIG,
  coerceBoundaryTransitionConfig,
  type BoundaryTransitionConfig,
} from "../boundaryTransition.ts";
import { saveJsonToLocalStorage } from "../storage.ts";
import {
  cloneCymaticSettings,
  createSettingsFromTemplate,
  type WavefieldTemplate,
} from "../templateSettings.ts";
import {
  DEFAULT_TEMPLATE_TRANSITION_CONFIG,
  TEMPLATE_TRANSITION_STORAGE_KEY,
  advanceTemplateTransition,
  coerceTemplateTransitionConfig,
  createEffectiveCymaticSettings,
  createTemplateTransition,
  type TemplateTransitionConfig,
  type TemplateTransitionState,
} from "../templateTransition.ts";
import type {
  BoundaryMode,
  CymaticSettings,
  EffectiveCymaticSettings,
} from "../types.ts";

export type SettingsTransitionAdvanceResult = {
  settings: EffectiveCymaticSettings;
  didCommitTemplate: boolean;
  didFinishBoundary: boolean;
};

export type BoundaryModeResult =
  | { changed: false; reason: "unchanged" }
  | { changed: true; morphed: boolean };

export class SettingsTransitionController {
  effectiveSettings: EffectiveCymaticSettings;
  boundaryTransitionConfig = loadBoundaryTransitionConfig();

  private templateTransition: TemplateTransitionState | null = null;
  private boundaryTransition: TemplateTransitionState | null = null;
  private readonly settings: CymaticSettings;

  constructor(settings: CymaticSettings) {
    this.settings = settings;
    this.effectiveSettings = createEffectiveCymaticSettings(settings);
  }

  get hasActiveTransition() {
    return this.templateTransition !== null || this.boundaryTransition !== null;
  }

  get boundaryControlsConfig() {
    return {
      ...this.boundaryTransitionConfig,
      applyBoundaryMode: true,
    };
  }

  resetToCurrentSettings() {
    this.templateTransition = null;
    this.boundaryTransition = null;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
  }

  syncRuntimeSettings() {
    this.effectiveSettings.driveMode = this.settings.driveMode;
    this.templateTransition = syncTransitionRuntimeSettings(
      this.templateTransition,
      this.settings,
    );
    this.boundaryTransition = syncTransitionRuntimeSettings(
      this.boundaryTransition,
      this.settings,
    );
  }

  startTemplateTransition(
    template: WavefieldTemplate,
    config: TemplateTransitionConfig,
  ) {
    const nextSettings = createSettingsFromTemplate(
      template.settings,
      this.settings,
    );
    this.boundaryTransition = null;
    this.templateTransition = createTemplateTransition(
      this.effectiveSettings,
      nextSettings,
      config,
    );

    if (config.applyBoundaryMode) {
      this.settings.boundaryMode = nextSettings.boundaryMode;
      return { appliedBoundaryMode: true };
    }

    return { appliedBoundaryMode: false };
  }

  advance(deltaSeconds: number): SettingsTransitionAdvanceResult {
    if (!this.templateTransition && !this.boundaryTransition) {
      return {
        settings: this.effectiveSettings,
        didCommitTemplate: false,
        didFinishBoundary: false,
      };
    }

    if (this.templateTransition) {
      const result = advanceTemplateTransition(
        this.templateTransition,
        deltaSeconds,
      );
      this.templateTransition = result.done ? null : result.transition;
      this.effectiveSettings = result.settings;

      if (result.done) {
        this.commitEffectiveSettings(result.settings);
      }

      return {
        settings: this.effectiveSettings,
        didCommitTemplate: result.done,
        didFinishBoundary: false,
      };
    }

    const boundaryTransition = this.boundaryTransition;
    if (!boundaryTransition) {
      return {
        settings: this.effectiveSettings,
        didCommitTemplate: false,
        didFinishBoundary: false,
      };
    }

    const result = advanceTemplateTransition(boundaryTransition, deltaSeconds);
    this.boundaryTransition = result.done ? null : result.transition;
    this.effectiveSettings = result.done
      ? createEffectiveCymaticSettings(this.settings)
      : result.settings;

    return {
      settings: this.effectiveSettings,
      didCommitTemplate: false,
      didFinishBoundary: result.done,
    };
  }

  setBoundaryMode(boundaryMode: BoundaryMode): BoundaryModeResult {
    if (this.settings.boundaryMode === boundaryMode && !this.hasActiveTransition) {
      return { changed: false, reason: "unchanged" };
    }

    const sourceSettings = this.effectiveSettings;
    const shouldMorph = this.boundaryTransitionConfig.enabled;
    this.settings.boundaryMode = boundaryMode;
    if (shouldMorph) {
      this.templateTransition = null;
      this.boundaryTransition = createTemplateTransition(
        sourceSettings,
        this.settings,
        this.boundaryTransitionConfig,
      );
      this.effectiveSettings = sourceSettings;
      return { changed: true, morphed: true };
    }

    this.resetToCurrentSettings();
    return { changed: true, morphed: false };
  }

  setBoundaryTransitionConfig(config: BoundaryTransitionConfig) {
    Object.assign(
      this.boundaryTransitionConfig,
      coerceBoundaryTransitionConfig(config),
    );
    saveJsonToLocalStorage(
      BOUNDARY_TRANSITION_STORAGE_KEY,
      this.boundaryTransitionConfig,
    );
  }

  private commitEffectiveSettings(settings: EffectiveCymaticSettings) {
    const currentDriveMode = this.settings.driveMode;
    Object.assign(this.settings, cloneCymaticSettings(settings));
    this.settings.driveMode = currentDriveMode;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
  }
}

export function loadTemplateTransitionConfig() {
  try {
    const rawValue = window.localStorage.getItem(
      TEMPLATE_TRANSITION_STORAGE_KEY,
    );
    const config = coerceTemplateTransitionConfig(
      rawValue ? JSON.parse(rawValue) : DEFAULT_TEMPLATE_TRANSITION_CONFIG,
    );
    config.applyBoundaryMode = true;
    saveJsonToLocalStorage(TEMPLATE_TRANSITION_STORAGE_KEY, config);
    return config;
  } catch {
    return { ...DEFAULT_TEMPLATE_TRANSITION_CONFIG };
  }
}

function loadBoundaryTransitionConfig() {
  try {
    const rawValue = window.localStorage.getItem(
      BOUNDARY_TRANSITION_STORAGE_KEY,
    );
    return coerceBoundaryTransitionConfig(
      rawValue ? JSON.parse(rawValue) : DEFAULT_BOUNDARY_TRANSITION_CONFIG,
    );
  } catch {
    return { ...DEFAULT_BOUNDARY_TRANSITION_CONFIG };
  }
}

function syncTransitionRuntimeSettings(
  transition: TemplateTransitionState | null,
  settings: CymaticSettings,
) {
  if (!transition) {
    return null;
  }

  transition.from.driveMode = settings.driveMode;
  transition.to.driveMode = settings.driveMode;
  return transition;
}
