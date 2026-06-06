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

export type TemplateTransitionEasing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut";

export type TemplateTransitionConfig = {
  durationSeconds: number;
  easing: TemplateTransitionEasing;
  applyBoundaryMode: boolean;
};

export type TemplateTransitionState = {
  from: EffectiveCymaticSettings;
  to: EffectiveCymaticSettings;
  elapsedSeconds: number;
  durationSeconds: number;
  easing: TemplateTransitionEasing;
};

type TemplateTransitionTimingConfig = {
  durationSeconds: number;
  easing: TemplateTransitionEasing;
  applyBoundaryMode?: boolean;
};

export const TEMPLATE_TRANSITION_STORAGE_KEY =
  "wavefield:template-transition:v1";

export const DEFAULT_TEMPLATE_TRANSITION_CONFIG: TemplateTransitionConfig = {
  durationSeconds: 1.25,
  easing: "easeInOut",
  applyBoundaryMode: true,
};

const BOUNDARY_MODES = [
  "freePlate",
  "dirichlet",
  "neumann",
  "clamped",
  "supported",
] satisfies BoundaryMode[];

const FIELD_MODELS = [
  "modalPlate",
  "radialPlate",
  "faradayPulse",
  "spiralPhase",
] satisfies FieldModel[];

const POST_EFFECT_IDS = [
  "bloom",
  "pixelation",
  "fisheye",
  "alphaDecay",
  "terminal",
] satisfies PostEffectId[];

const INTEGER_SETTING_KEYS = new Set<keyof CymaticSettings>([
  "modalCount",
  "sphereRaymarchSteps",
  "postPixelSize",
  "postAlphaDecayFrames",
  "terminalCellSize",
  "terminalContourLevels",
]);

const POST_EFFECT_ENABLED_KEYS = {
  bloom: "postBloomEnabled",
  pixelation: "postPixelationEnabled",
  fisheye: "postFisheyeEnabled",
  alphaDecay: "postAlphaDecayEnabled",
  terminal: "terminalContourEnabled",
} satisfies Record<PostEffectId, keyof CymaticSettings>;

type PostEffectOffValueConfig = {
  effectId: PostEffectId;
  value: number;
};

const POST_EFFECT_OFF_VALUES: Partial<
  Record<keyof CymaticSettings, PostEffectOffValueConfig>
> = {
  postBloomIntensity: { effectId: "bloom", value: 0 },
  postPixelSize: { effectId: "pixelation", value: 1 },
  postFisheyeStrength: { effectId: "fisheye", value: 0 },
  postAlphaDecayFrames: { effectId: "alphaDecay", value: 0 },
  terminalCellSize: { effectId: "terminal", value: 0 },
  terminalContourLevels: { effectId: "terminal", value: 0 },
  terminalContourStrength: { effectId: "terminal", value: 0 },
  terminalContourThreshold: { effectId: "terminal", value: 0 },
};

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

export function createTemplateTransition(
  from: EffectiveCymaticSettings,
  target: CymaticSettings,
  config: TemplateTransitionTimingConfig,
): TemplateTransitionState {
  const to = createEffectiveCymaticSettings({
    ...target,
    boundaryMode:
      (config.applyBoundaryMode ?? true)
        ? target.boundaryMode
        : from.boundaryMode,
    driveMode: from.driveMode,
  });
  return {
    from: cloneEffectiveCymaticSettings(from),
    to,
    elapsedSeconds: 0,
    durationSeconds: Math.max(0, config.durationSeconds),
    easing: config.easing,
  };
}

export function advanceTemplateTransition(
  transition: TemplateTransitionState,
  deltaSeconds: number,
) {
  const durationSeconds = Math.max(0, transition.durationSeconds);
  const elapsedSeconds =
    durationSeconds <= 0
      ? durationSeconds
      : Math.min(
          durationSeconds,
          transition.elapsedSeconds + Math.max(0, deltaSeconds),
        );
  const rawProgress =
    durationSeconds <= 0 ? 1 : clamp01(elapsedSeconds / durationSeconds);
  const easedProgress = applyTemplateEasing(rawProgress, transition.easing);
  const settings = interpolateEffectiveSettings(
    transition.from,
    transition.to,
    easedProgress,
    rawProgress >= 1,
  );

  return {
    transition: {
      ...transition,
      elapsedSeconds,
    },
    settings,
    done: rawProgress >= 1,
  };
}

export function interpolateEffectiveSettings(
  from: EffectiveCymaticSettings,
  to: EffectiveCymaticSettings,
  progress: number,
  isComplete = progress >= 1,
): EffectiveCymaticSettings {
  const t = clamp01(progress);
  const result = cloneEffectiveCymaticSettings(to);
  result.driveMode = from.driveMode;

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<
    keyof CymaticSettings
  >) {
    if (key === "driveMode") {
      continue;
    }

    if (key === "postEffectOrder") {
      result.postEffectOrder = isComplete
        ? [...to.postEffectOrder]
        : unionPostEffectOrder(from.postEffectOrder, to.postEffectOrder);
      continue;
    }

    const fromValue = from[key];
    const toValue = to[key];
    if (typeof fromValue === "number" && typeof toValue === "number") {
      const endpoint = getPostEffectNumericEndpoint(
        key,
        from,
        to,
        fromValue,
        toValue,
      );
      const value = lerp(endpoint.fromValue, endpoint.toValue, t);
      (result[key] as number) = INTEGER_SETTING_KEYS.has(key)
        ? Math.round(value)
        : value;
      continue;
    }

    if (
      typeof fromValue === "string" &&
      typeof toValue === "string" &&
      isHexColor(fromValue) &&
      isHexColor(toValue)
    ) {
      (result[key] as string) = lerpHexColor(fromValue, toValue, t);
      continue;
    }

    (result[key] as CymaticSettings[typeof key]) = isComplete
      ? toValue
      : fromValue;
  }

  result.boundaryWeights = interpolateBoundaryWeights(
    from.boundaryWeights,
    to.boundaryWeights,
    t,
  );
  result.fieldModelWeights = interpolateFieldModelWeights(
    from.fieldModelWeights,
    to.fieldModelWeights,
    t,
  );
  result.postEffectAmounts = interpolatePostEffectAmounts(
    from.postEffectAmounts,
    to.postEffectAmounts,
    t,
  );
  applyPostEffectEnablement(result, isComplete, from, to);
  return result;
}

export function applyTemplateEasing(
  progress: number,
  easing: TemplateTransitionEasing,
) {
  const t = clamp01(progress);
  switch (easing) {
    case "linear":
      return t;
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}

export function coerceTemplateTransitionConfig(
  input: unknown,
): TemplateTransitionConfig {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_TEMPLATE_TRANSITION_CONFIG };
  }

  const source = input as Partial<Record<keyof TemplateTransitionConfig, unknown>>;
  const durationSeconds =
    typeof source.durationSeconds === "number" &&
    Number.isFinite(source.durationSeconds)
      ? clamp(source.durationSeconds, 0, 12)
      : DEFAULT_TEMPLATE_TRANSITION_CONFIG.durationSeconds;
  const easing =
    source.easing === "linear" ||
    source.easing === "easeIn" ||
    source.easing === "easeOut" ||
    source.easing === "easeInOut"
      ? source.easing
      : DEFAULT_TEMPLATE_TRANSITION_CONFIG.easing;
  const applyBoundaryMode =
    typeof source.applyBoundaryMode === "boolean"
      ? source.applyBoundaryMode
      : DEFAULT_TEMPLATE_TRANSITION_CONFIG.applyBoundaryMode;

  return { durationSeconds, easing, applyBoundaryMode };
}

export function cloneEffectiveCymaticSettings(
  settings: EffectiveCymaticSettings,
): EffectiveCymaticSettings {
  return {
    ...cloneCymaticSettings(settings),
    fieldModelWeights: {
      ...getFieldModelWeights(settings.fieldModel),
      ...settings.fieldModelWeights,
    },
    boundaryWeights: { ...settings.boundaryWeights },
    postEffectAmounts: { ...settings.postEffectAmounts },
  };
}

function getFieldModelWeights(fieldModel: FieldModel): FieldModelWeights {
  return {
    modalPlate: fieldModel === "modalPlate" ? 1 : 0,
    radialPlate: fieldModel === "radialPlate" ? 1 : 0,
    faradayPulse: fieldModel === "faradayPulse" ? 1 : 0,
    spiralPhase: fieldModel === "spiralPhase" ? 1 : 0,
  };
}

function getBoundaryWeights(boundaryMode: BoundaryMode): BoundaryWeights {
  return {
    freePlate: boundaryMode === "freePlate" ? 1 : 0,
    dirichlet: boundaryMode === "dirichlet" ? 1 : 0,
    neumann: boundaryMode === "neumann" ? 1 : 0,
    clamped: boundaryMode === "clamped" ? 1 : 0,
    supported: boundaryMode === "supported" ? 1 : 0,
  };
}

function getPostEffectAmounts(settings: CymaticSettings): PostEffectAmounts {
  return {
    bloom: isPostEffectEnabled(settings, "bloom") ? 1 : 0,
    pixelation: isPostEffectEnabled(settings, "pixelation") ? 1 : 0,
    fisheye: isPostEffectEnabled(settings, "fisheye") ? 1 : 0,
    alphaDecay: isPostEffectEnabled(settings, "alphaDecay") ? 1 : 0,
    terminal: isPostEffectEnabled(settings, "terminal") ? 1 : 0,
  };
}

function isPostEffectEnabled(settings: CymaticSettings, effectId: PostEffectId) {
  return Boolean(
    settings.postProcessingEnabled && settings[POST_EFFECT_ENABLED_KEYS[effectId]],
  );
}

function interpolateFieldModelWeights(
  from: FieldModelWeights,
  to: FieldModelWeights,
  progress: number,
): FieldModelWeights {
  return {
    modalPlate: lerp(from.modalPlate, to.modalPlate, progress),
    radialPlate: lerp(from.radialPlate, to.radialPlate, progress),
    faradayPulse: lerp(from.faradayPulse, to.faradayPulse, progress),
    spiralPhase: lerp(from.spiralPhase, to.spiralPhase, progress),
  };
}

function interpolateBoundaryWeights(
  from: BoundaryWeights,
  to: BoundaryWeights,
  progress: number,
): BoundaryWeights {
  return {
    freePlate: lerp(from.freePlate, to.freePlate, progress),
    dirichlet: lerp(from.dirichlet, to.dirichlet, progress),
    neumann: lerp(from.neumann, to.neumann, progress),
    clamped: lerp(from.clamped, to.clamped, progress),
    supported: lerp(from.supported, to.supported, progress),
  };
}

function interpolatePostEffectAmounts(
  from: PostEffectAmounts,
  to: PostEffectAmounts,
  progress: number,
): PostEffectAmounts {
  return {
    bloom: lerp(from.bloom, to.bloom, progress),
    pixelation: lerp(from.pixelation, to.pixelation, progress),
    fisheye: lerp(from.fisheye, to.fisheye, progress),
    alphaDecay: lerp(from.alphaDecay, to.alphaDecay, progress),
    terminal: lerp(from.terminal, to.terminal, progress),
  };
}

function getPostEffectNumericEndpoint(
  key: keyof CymaticSettings,
  from: EffectiveCymaticSettings,
  to: EffectiveCymaticSettings,
  fromValue: number,
  toValue: number,
) {
  const config = POST_EFFECT_OFF_VALUES[key];
  if (!config) {
    return { fromValue, toValue };
  }

  return {
    fromValue: isPostEffectEnabled(from, config.effectId)
      ? fromValue
      : config.value,
    toValue: isPostEffectEnabled(to, config.effectId) ? toValue : config.value,
  };
}

function applyPostEffectEnablement(
  settings: EffectiveCymaticSettings,
  isComplete: boolean,
  from: EffectiveCymaticSettings,
  target: EffectiveCymaticSettings,
) {
  const participatingEffects = POST_EFFECT_IDS.filter(
    (effectId) =>
      isPostEffectEnabled(from, effectId) ||
      isPostEffectEnabled(target, effectId),
  );
  settings.postProcessingEnabled = isComplete
    ? target.postProcessingEnabled
    : participatingEffects.length > 0;

  for (const effectId of POST_EFFECT_IDS) {
    settings[POST_EFFECT_ENABLED_KEYS[effectId]] = isComplete
      ? target[POST_EFFECT_ENABLED_KEYS[effectId]]
      : participatingEffects.includes(effectId);
  }
}

function unionPostEffectOrder(left: PostEffectId[], right: PostEffectId[]) {
  const order: PostEffectId[] = [];
  for (const effectId of [...right, ...left]) {
    if (!order.includes(effectId)) {
      order.push(effectId);
    }
  }
  return order;
}

function lerp(left: number, right: number, progress: number) {
  return left + (right - left) * progress;
}

function lerpHexColor(left: string, right: string, progress: number) {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  return rgbToHex(
    Math.round(lerp(leftRgb[0], rightRgb[0], progress)),
    Math.round(lerp(leftRgb[1], rightRgb[1], progress)),
    Math.round(lerp(leftRgb[2], rightRgb[2], progress)),
  );
}

function hexToRgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
