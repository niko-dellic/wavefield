import { clamp } from "./math/clamp.ts";
import { loadJsonFromLocalStorage, saveJsonToLocalStorage } from "./storage.ts";
import type { ScreenViewTransform } from "./webgl/renderTypes.ts";

export type WanderConfig = {
  enabled: boolean;
  panEnabled: boolean;
  depthEnabled: boolean;
  rotateEnabled: boolean;
  panSpeed: number;
  depthSpeed: number;
  rotateSpeed: number;
  minDepth: number;
  maxDepth: number;
  resumeDelaySeconds: number;
};

export const WANDER_STORAGE_KEY = "wavefield:wander:v1";

export const DEFAULT_WANDER_CONFIG: WanderConfig = {
  enabled: false,
  panEnabled: false,
  depthEnabled: false,
  rotateEnabled: false,
  panSpeed: 1,
  depthSpeed: 1,
  rotateSpeed: 1,
  minDepth: 0.65,
  maxDepth: 1.75,
  resumeDelaySeconds: 1.5,
};

const WANDER_PAN_SPEED = 0.018;
const WANDER_DEPTH_LOG_SPEED = 0.026;
const WANDER_ROTATE_SPEED = 0.075;

export type WanderStepOptions = {
  minScale: number;
  maxScale: number;
};

export function coerceWanderConfig(input: unknown): WanderConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_WANDER_CONFIG };
  }

  const source = input as Partial<Record<keyof WanderConfig, unknown>>;
  const minDepth = coerceNumber(
    source.minDepth,
    DEFAULT_WANDER_CONFIG.minDepth,
    0.05,
    16,
  );
  const maxDepth = Math.max(
    minDepth,
    coerceNumber(source.maxDepth, DEFAULT_WANDER_CONFIG.maxDepth, 0.05, 16),
  );
  return {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : source.panEnabled === true ||
          source.depthEnabled === true ||
          source.rotateEnabled === true,
    panEnabled:
      typeof source.panEnabled === "boolean"
        ? source.panEnabled
        : DEFAULT_WANDER_CONFIG.panEnabled,
    depthEnabled:
      typeof source.depthEnabled === "boolean"
        ? source.depthEnabled
        : DEFAULT_WANDER_CONFIG.depthEnabled,
    rotateEnabled:
      typeof source.rotateEnabled === "boolean"
        ? source.rotateEnabled
        : DEFAULT_WANDER_CONFIG.rotateEnabled,
    panSpeed: coerceNumber(
      source.panSpeed,
      DEFAULT_WANDER_CONFIG.panSpeed,
      0,
      10,
    ),
    depthSpeed: coerceNumber(
      source.depthSpeed,
      DEFAULT_WANDER_CONFIG.depthSpeed,
      0,
      10,
    ),
    rotateSpeed: coerceNumber(
      source.rotateSpeed,
      DEFAULT_WANDER_CONFIG.rotateSpeed,
      0,
      10,
    ),
    minDepth,
    maxDepth,
    resumeDelaySeconds: coerceNumber(
      source.resumeDelaySeconds,
      DEFAULT_WANDER_CONFIG.resumeDelaySeconds,
      0,
      10,
    ),
  };
}

export function loadWanderConfig() {
  return loadJsonFromLocalStorage(
    WANDER_STORAGE_KEY,
    DEFAULT_WANDER_CONFIG,
    coerceWanderConfig,
  );
}

export function saveWanderConfig(config: WanderConfig) {
  saveJsonToLocalStorage(WANDER_STORAGE_KEY, coerceWanderConfig(config));
}

export function stepWanderTarget(
  target: ScreenViewTransform,
  config: WanderConfig,
  elapsedSeconds: number,
  deltaSeconds: number,
  options: WanderStepOptions,
) {
  const safeDeltaSeconds = Math.max(0, deltaSeconds);
  if (safeDeltaSeconds === 0) {
    return;
  }

  if (!config.enabled) {
    return;
  }

  if (config.panEnabled && config.panSpeed > 0) {
    const safeScale = Math.max(0.001, target.scale);
    const velocityX =
      Math.sin(elapsedSeconds * 0.23) +
      Math.sin(elapsedSeconds * 0.071 + 2.1) * 0.55;
    const velocityY =
      Math.cos(elapsedSeconds * 0.19 + 0.8) +
      Math.sin(elapsedSeconds * 0.053 + 4.4) * 0.45;
    target.offsetX +=
      (velocityX * WANDER_PAN_SPEED * config.panSpeed * safeDeltaSeconds) /
      safeScale;
    target.offsetY +=
      (velocityY * WANDER_PAN_SPEED * config.panSpeed * safeDeltaSeconds) /
      safeScale;
  }

  if (config.depthEnabled && config.depthSpeed > 0) {
    const logScaleVelocity =
      Math.sin(elapsedSeconds * 0.17 + 1.2) * WANDER_DEPTH_LOG_SPEED +
      Math.sin(elapsedSeconds * 0.047 + 3.6) * WANDER_DEPTH_LOG_SPEED * 0.55;
    target.scale = clamp(
      target.scale *
        Math.exp(logScaleVelocity * config.depthSpeed * safeDeltaSeconds),
      Math.max(options.minScale, config.minDepth),
      Math.min(options.maxScale, config.maxDepth),
    );
  }

  if (config.rotateEnabled && config.rotateSpeed > 0) {
    const rotationVelocity =
      Math.sin(elapsedSeconds * 0.11 + 0.4) * WANDER_ROTATE_SPEED +
      Math.sin(elapsedSeconds * 0.037 + 2.9) * WANDER_ROTATE_SPEED * 0.6;
    target.rotation += rotationVelocity * config.rotateSpeed * safeDeltaSeconds;
  }
}

function coerceNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}
