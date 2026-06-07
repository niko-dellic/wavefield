import { DEFAULT_SETTINGS } from "./config/settings.ts";
import { cloneCymaticSettings } from "./templateSettings.ts";
import type {
  BoundaryMode,
  BoundaryWeights,
  CymaticSettings,
  EffectiveCymaticSettings,
  FieldModel,
  FieldModelWeights,
  PostEffectAmounts,
  PostEffectId,
} from "./types.ts";

export const BOUNDARY_MODES = [
  "freePlate",
  "dirichlet",
  "neumann",
  "clamped",
  "supported",
] satisfies BoundaryMode[];

export const FIELD_MODELS = [
  "modalPlate",
  "radialPlate",
  "faradayPulse",
  "spiralPhase",
] satisfies FieldModel[];

export const POST_EFFECT_IDS = [
  "bloom",
  "pixelation",
  "fisheye",
  "alphaDecay",
  "terminal",
] satisfies PostEffectId[];

export const POST_EFFECT_ENABLED_KEYS = {
  bloom: "postBloomEnabled",
  pixelation: "postPixelationEnabled",
  fisheye: "postFisheyeEnabled",
  alphaDecay: "postAlphaDecayEnabled",
  terminal: "terminalContourEnabled",
} satisfies Record<PostEffectId, keyof CymaticSettings>;

/**
 * Builds the renderer-facing settings object from persisted/user settings.
 * This is the single source for derived model weights, resonance weights, and
 * post-effect fade amounts used by transitions and WebGL controllers.
 */
export function createEffectiveCymaticSettings(
  settings: CymaticSettings,
): EffectiveCymaticSettings {
  const cloned = cloneCymaticSettings(settings);
  return {
    ...cloned,
    fieldModelWeights: getFieldModelWeights(cloned.fieldModel),
    boundaryWeights: getBoundaryWeights(cloned.boundaryMode),
    postEffectAmounts: getPostEffectAmounts(cloned),
  };
}

/** Clones effective settings while preserving any in-flight interpolated weights. */
export function cloneEffectiveCymaticSettings(
  settings: EffectiveCymaticSettings,
): EffectiveCymaticSettings {
  return {
    ...cloneCymaticSettings(settings),
    fieldModelWeights: {
      ...getFieldModelWeights(settings.fieldModel),
      ...settings.fieldModelWeights,
    },
    boundaryWeights: {
      ...getBoundaryWeights(settings.boundaryMode),
      ...settings.boundaryWeights,
    },
    postEffectAmounts: {
      ...getPostEffectAmounts(settings),
      ...settings.postEffectAmounts,
    },
  };
}

/** Returns one-hot field model weights for steady-state rendering. */
export function getFieldModelWeights(fieldModel: FieldModel): FieldModelWeights {
  return {
    modalPlate: fieldModel === "modalPlate" ? 1 : 0,
    radialPlate: fieldModel === "radialPlate" ? 1 : 0,
    faradayPulse: fieldModel === "faradayPulse" ? 1 : 0,
    spiralPhase: fieldModel === "spiralPhase" ? 1 : 0,
  };
}

/** Returns one-hot resonance style weights for steady-state rendering. */
export function getBoundaryWeights(boundaryMode: BoundaryMode): BoundaryWeights {
  return {
    freePlate: boundaryMode === "freePlate" ? 1 : 0,
    dirichlet: boundaryMode === "dirichlet" ? 1 : 0,
    neumann: boundaryMode === "neumann" ? 1 : 0,
    clamped: boundaryMode === "clamped" ? 1 : 0,
    supported: boundaryMode === "supported" ? 1 : 0,
  };
}

/** Resolves effect fade amounts, using interpolated values when present. */
export function getPostEffectAmounts(
  settings: CymaticSettings | EffectiveCymaticSettings,
): PostEffectAmounts {
  if ("postEffectAmounts" in settings && settings.postEffectAmounts) {
    return settings.postEffectAmounts;
  }

  return {
    bloom: isPostEffectEnabled(settings, "bloom") ? 1 : 0,
    pixelation: isPostEffectEnabled(settings, "pixelation") ? 1 : 0,
    fisheye: isPostEffectEnabled(settings, "fisheye") ? 1 : 0,
    alphaDecay: isPostEffectEnabled(settings, "alphaDecay") ? 1 : 0,
    terminal: isPostEffectEnabled(settings, "terminal") ? 1 : 0,
  };
}

/** Returns a single post-effect amount after applying transition overrides. */
export function getPostEffectAmount(
  settings: CymaticSettings | EffectiveCymaticSettings,
  effectId: PostEffectId,
): number {
  return getPostEffectAmounts(settings)[effectId];
}

/** True when a post effect is enabled in the base settings. */
export function isPostEffectEnabled(
  settings: CymaticSettings | EffectiveCymaticSettings,
  effectId: PostEffectId,
): boolean {
  return Boolean(
    settings.postProcessingEnabled && settings[POST_EFFECT_ENABLED_KEYS[effectId]],
  );
}

/** True when any transition amount still requires a post pass to render. */
export function hasActivePostEffectAmount(amounts: PostEffectAmounts): boolean {
  return Object.values(amounts).some((amount: number): boolean => amount > 0.001);
}

/** Fallback effective settings used by tests or callers that need a complete shape. */
export const DEFAULT_EFFECTIVE_SETTINGS: EffectiveCymaticSettings =
  createEffectiveCymaticSettings(DEFAULT_SETTINGS);
