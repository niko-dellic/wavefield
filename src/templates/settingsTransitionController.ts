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
  FieldModel,
} from "../types.ts";

export type SettingsTransitionAdvanceResult = {
  settings: EffectiveCymaticSettings;
  didCommitTemplate: boolean;
  didFinishBoundary: boolean;
};

export type ResonanceTransitionResult =
  | { changed: false; reason: "unchanged" }
  | { changed: true; morphed: boolean };

export type TemplateTransitionStartResult = {
  appliedBoundaryMode: boolean;
};

/** Coordinates template and resonance transitions while preserving runtime drive state. */
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

  /** True when either a template or resonance transition is currently in flight. */
  get hasActiveTransition(): boolean {
    return this.templateTransition !== null || this.boundaryTransition !== null;
  }

  /** Returns the UI-facing resonance transition config shape. */
  get boundaryControlsConfig(): BoundaryTransitionConfig & {
    applyBoundaryMode: boolean;
  } {
    return {
      ...this.boundaryTransitionConfig,
      applyBoundaryMode: true,
    };
  }

  /** Cancels active transitions and rebuilds effective settings from live settings. */
  resetToCurrentSettings(): void {
    this.templateTransition = null;
    this.boundaryTransition = null;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
  }

  /** Pushes runtime-only drive mode into active transitions without changing visuals. */
  syncRuntimeSettings(): void {
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
  ): TemplateTransitionStartResult {
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

  /** Advances the active transition and returns the settings to render this frame. */
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

  /** Changes resonance style, optionally morphing from the current effective state. */
  setBoundaryMode(boundaryMode: BoundaryMode): ResonanceTransitionResult {
    if (
      this.settings.boundaryMode === boundaryMode &&
      this.effectiveSettings.boundaryMode === boundaryMode &&
      !this.hasActiveTransition
    ) {
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

  /** Changes field model immediately and refreshes derived field model weights. */
  setFieldModel(fieldModel: FieldModel): ResonanceTransitionResult {
    if (
      this.settings.fieldModel === fieldModel &&
      this.effectiveSettings.fieldModel === fieldModel &&
      !this.hasActiveTransition
    ) {
      return { changed: false, reason: "unchanged" };
    }

    this.settings.fieldModel = fieldModel;
    this.resetToCurrentSettings();
    return { changed: true, morphed: false };
  }

  /** Persists resonance transition controls after validating user-provided values. */
  setBoundaryTransitionConfig(config: BoundaryTransitionConfig): void {
    Object.assign(
      this.boundaryTransitionConfig,
      coerceBoundaryTransitionConfig(config),
    );
    saveJsonToLocalStorage(
      BOUNDARY_TRANSITION_STORAGE_KEY,
      this.boundaryTransitionConfig,
    );
  }

  private commitEffectiveSettings(settings: EffectiveCymaticSettings): void {
    const currentDriveMode = this.settings.driveMode;
    Object.assign(this.settings, cloneCymaticSettings(settings));
    this.settings.driveMode = currentDriveMode;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
  }
}

export function loadTemplateTransitionConfig(): TemplateTransitionConfig {
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

function loadBoundaryTransitionConfig(): BoundaryTransitionConfig {
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
): TemplateTransitionState | null {
  if (!transition) {
    return null;
  }

  transition.from.driveMode = settings.driveMode;
  transition.to.driveMode = settings.driveMode;
  return transition;
}
