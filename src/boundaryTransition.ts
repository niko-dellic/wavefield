import {
  DEFAULT_TEMPLATE_TRANSITION_CONFIG,
  coerceTemplateTransitionConfig,
  type TemplateTransitionEasing,
} from "./templateTransition.ts";

export type BoundaryTransitionConfig = {
  enabled: boolean;
  durationSeconds: number;
  easing: TemplateTransitionEasing;
};

export const BOUNDARY_TRANSITION_STORAGE_KEY =
  "wavefield:boundary-transition:v1";

export const DEFAULT_BOUNDARY_TRANSITION_CONFIG: BoundaryTransitionConfig = {
  enabled: true,
  durationSeconds: DEFAULT_TEMPLATE_TRANSITION_CONFIG.durationSeconds,
  easing: DEFAULT_TEMPLATE_TRANSITION_CONFIG.easing,
};

export function coerceBoundaryTransitionConfig(
  input: unknown,
): BoundaryTransitionConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_BOUNDARY_TRANSITION_CONFIG };
  }

  const timing = coerceTemplateTransitionConfig(input);
  return {
    enabled:
      typeof (input as { enabled?: unknown }).enabled === "boolean"
        ? (input as { enabled: boolean }).enabled
        : DEFAULT_BOUNDARY_TRANSITION_CONFIG.enabled,
    durationSeconds: timing.durationSeconds,
    easing: timing.easing,
  };
}
