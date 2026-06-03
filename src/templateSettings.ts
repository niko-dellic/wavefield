import { DEFAULT_SETTINGS } from "./config/settings";
import type {
  AlphaDecayBlendMode,
  BoundaryMode,
  ColorMode,
  CymaticSettings,
  DriveMode,
  HeatmapPalette,
  MonitorSignal,
  PostEffectId,
  ProjectionMode,
  ScreenAspectMode,
  SphereFieldMode,
  SphereProjectionType,
} from "./types";

export type WavefieldTemplate = {
  slug: string;
  name: string;
  createdAt: string;
  settings: CymaticSettings;
};

type RawWavefieldTemplate = {
  name?: unknown;
  createdAt?: unknown;
  settings?: unknown;
};

const FALLBACK_CREATED_AT = "1970-01-01T00:00:00.000Z";

const STRING_OPTIONS: Partial<Record<keyof CymaticSettings, readonly string[]>> = {
  projectionMode: ["screen", "sphere"] satisfies ProjectionMode[],
  boundaryMode: ["freePlate", "dirichlet", "neumann"] satisfies BoundaryMode[],
  colorMode: [
    "chromesthesia",
    "mono",
    "bandSplit",
    "thermalPhase",
    "heatmap",
  ] satisfies ColorMode[],
  sphereFieldMode: ["surface", "volume"] satisfies SphereFieldMode[],
  sphereProjectionType: ["uv", "triplanar"] satisfies SphereProjectionType[],
  screenAspectMode: ["circle", "fit"] satisfies ScreenAspectMode[],
  idleMode: ["ambient"],
  monitorSignal: [
    "frequency",
    "level",
    "excitation",
    "change",
    "pulse",
    "low",
    "mid",
    "high",
  ] satisfies MonitorSignal[],
  heatmapPalette: [
    "scientificHeat",
    "blackbody",
    "turbo",
  ] satisfies HeatmapPalette[],
  driveMode: ["audio", "manual", "live"] satisfies DriveMode[],
  postAlphaDecayBlendMode: [
    "normal",
    "screen",
    "multiply",
    "overlay",
    "add",
    "subtract",
    "darken",
    "lighten",
    "difference",
    "exclusion",
    "softLight",
    "hardLight",
  ] satisfies AlphaDecayBlendMode[],
};

const POST_EFFECT_IDS = [
  "bloom",
  "pixelation",
  "fisheye",
  "alphaDecay",
  "terminal",
] satisfies PostEffectId[];

export function cloneCymaticSettings(
  settings: CymaticSettings,
): CymaticSettings {
  return {
    ...settings,
    postEffectOrder: [...settings.postEffectOrder],
  };
}

export function coerceCymaticSettings(input: unknown): CymaticSettings {
  const source = isRecord(input) ? input : {};
  const settings = cloneCymaticSettings(DEFAULT_SETTINGS);

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<
    keyof CymaticSettings
  >) {
    const defaultValue = DEFAULT_SETTINGS[key];
    const value = source[key];

    if (key === "postEffectOrder") {
      settings.postEffectOrder = coercePostEffectOrder(value);
      continue;
    }

    if (typeof defaultValue === "number") {
      if (typeof value === "number" && Number.isFinite(value)) {
        (settings[key] as number) = value;
      }
      continue;
    }

    if (typeof defaultValue === "boolean") {
      if (typeof value === "boolean") {
        (settings[key] as boolean) = value;
      }
      continue;
    }

    if (typeof defaultValue === "string") {
      const allowedValues = STRING_OPTIONS[key];
      if (typeof value !== "string") {
        continue;
      }

      if (allowedValues && !allowedValues.includes(value)) {
        continue;
      }

      (settings[key] as string) = value;
    }
  }

  return settings;
}

export function coerceWavefieldTemplate(
  input: unknown,
  fallbackSlug: string,
): WavefieldTemplate {
  const source = (isRecord(input) ? input : {}) as RawWavefieldTemplate;
  const slug = sanitizeTemplateSlug(
    isRecord(input) && typeof input.slug === "string"
      ? input.slug
      : fallbackSlug,
  );
  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : formatTemplateName(slug);
  const createdAt =
    typeof source.createdAt === "string" && !Number.isNaN(Date.parse(source.createdAt))
      ? source.createdAt
      : FALLBACK_CREATED_AT;

  return {
    slug,
    name,
    createdAt,
    settings: coerceCymaticSettings(source.settings),
  };
}

export function loadWavefieldTemplates(
  modules: Record<string, unknown>,
): WavefieldTemplate[] {
  return sortWavefieldTemplates(
    Object.entries(modules).map(([path, value]) =>
      coerceWavefieldTemplate(value, getTemplateSlugFromPath(path)),
    ),
  );
}

export function sortWavefieldTemplates(
  templates: WavefieldTemplate[],
): WavefieldTemplate[] {
  return [...templates].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

function coercePostEffectOrder(value: unknown): PostEffectId[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SETTINGS.postEffectOrder];
  }

  const order = value.filter((item): item is PostEffectId =>
    POST_EFFECT_IDS.includes(item as PostEffectId),
  );
  for (const effectId of DEFAULT_SETTINGS.postEffectOrder) {
    if (!order.includes(effectId)) {
      order.push(effectId);
    }
  }

  return order;
}

function sanitizeTemplateSlug(slug: string) {
  return slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "template";
}

function getTemplateSlugFromPath(path: string) {
  return path.split("/").pop()?.replace(/\.json$/i, "") ?? "template";
}

function formatTemplateName(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
