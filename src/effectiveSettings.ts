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

export type ComposerPostEffectId = Exclude<PostEffectId, "fisheye" | "terminal">;

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

export const COMPOSER_POST_EFFECT_IDS = [
  "bloom",
  "pixelation",
  "alphaDecay",
] satisfies ComposerPostEffectId[];

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

/** Returns the visual amount that makes a composer-owned effect worth rendering. */
export function getComposerPostEffectRenderAmount(
  settings: CymaticSettings | EffectiveCymaticSettings,
  effectId: ComposerPostEffectId,
): number {
  const amount = getPostEffectAmount(settings, effectId);
  switch (effectId) {
    case "bloom":
      return amount * Math.max(0, settings.postBloomIntensity);
    case "pixelation":
      return amount * Math.max(0, settings.postPixelSize - 1);
    case "alphaDecay":
      return amount;
  }
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
export function hasActiveComposerPostEffectAmount(
  amounts: PostEffectAmounts,
): boolean {
  return COMPOSER_POST_EFFECT_IDS.some(
    (effectId: ComposerPostEffectId): boolean => amounts[effectId] > 0.001,
  );
}

/**
 * Returns the exact composer-owned post-effect stack that should render this frame.
 *
 * Fisheye and terminal contours are intentionally excluded because they are
 * shader-native effects, not composer passes. During transitions this may
 * include fading composer effects whose base toggle is off, but disabled
 * effects with zero visual amount are excluded.
 */
export function getActiveComposerPostEffectIds(
  settings: CymaticSettings | EffectiveCymaticSettings,
): ComposerPostEffectId[] {
  const amounts = getPostEffectAmounts(settings);
  const hasEnabledComposerEffect = COMPOSER_POST_EFFECT_IDS.some(
    (effectId: ComposerPostEffectId): boolean =>
      isPostEffectEnabled(settings, effectId),
  );
  if (
    !settings.postProcessingEnabled &&
    !hasEnabledComposerEffect &&
    !hasActiveComposerPostEffectAmount(amounts)
  ) {
    return [];
  }

  return settings.postEffectOrder.flatMap(
    (effectId: PostEffectId): ComposerPostEffectId[] => {
      if (!isComposerPostEffectId(effectId)) {
        return [];
      }

      const isActive =
        (isPostEffectEnabled(settings, effectId) || amounts[effectId] > 0.001) &&
        getComposerPostEffectRenderAmount(settings, effectId) > 0.001;
      return isActive ? [effectId] : [];
    },
  );
}

/** True when an effect is implemented by the postprocessing composer. */
export function isComposerPostEffectId(
  effectId: PostEffectId,
): effectId is ComposerPostEffectId {
  return COMPOSER_POST_EFFECT_IDS.includes(effectId as ComposerPostEffectId);
}

/** Fallback effective settings used by tests or callers that need a complete shape. */
export const DEFAULT_EFFECTIVE_SETTINGS: EffectiveCymaticSettings =
  createEffectiveCymaticSettings(DEFAULT_SETTINGS);
