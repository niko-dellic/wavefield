import type { BoundaryMode } from "../types.ts";

export type SphericalMode = [number, number, number];

const MIN_MODE_INDEX = 1;
const MAX_MODE_INDEX = 28;

export function deriveSphericalModeFromChladniMode(
  mode: [number, number],
): SphericalMode {
  const [m, n] = mode;
  const w = clamp(Math.round(Math.hypot(m, n) * 0.72), MIN_MODE_INDEX, MAX_MODE_INDEX);
  return sortModeTriplet([
    clamp(Math.round(m), MIN_MODE_INDEX, MAX_MODE_INDEX),
    clamp(Math.round(n), MIN_MODE_INDEX, MAX_MODE_INDEX),
    w,
  ]);
}

export function getSphericalPermutationCount(mode: SphericalMode) {
  const [u, v, w] = sortModeTriplet(mode);
  if (u === w) {
    return 1;
  }

  if (u === v || v === w) {
    return 3;
  }

  return 6;
}

export function evaluateSphericalPermutationMode({
  mode,
  position,
  boundaryMode,
}: {
  mode: SphericalMode;
  position: SphericalMode;
  boundaryMode: BoundaryMode;
}) {
  const permutations = getUniquePermutations(sortModeTriplet(mode));
  const normalization = 1 / Math.sqrt(permutations.length);
  let field = 0;

  for (const [u, v, w] of permutations) {
    field +=
      evaluateBoundaryBasis(u, position[0], boundaryMode) *
      evaluateBoundaryBasis(v, position[1], boundaryMode) *
      evaluateBoundaryBasis(w, position[2], boundaryMode);
  }

  return field * normalization;
}

function getUniquePermutations(mode: SphericalMode): SphericalMode[] {
  const [u, v, w] = mode;
  const candidates: SphericalMode[] = [
    [u, v, w],
    [u, w, v],
    [v, u, w],
    [w, u, v],
    [v, w, u],
    [w, v, u],
  ];
  const seen = new Set<string>();
  const permutations: SphericalMode[] = [];

  for (const candidate of candidates) {
    const key = candidate.join(":");
    if (!seen.has(key)) {
      seen.add(key);
      permutations.push(candidate);
    }
  }

  return permutations;
}

function evaluateBoundaryBasis(
  modeIndex: number,
  coordinate: number,
  boundaryMode: BoundaryMode,
) {
  const argument = modeIndex * Math.PI * coordinate;
  return boundaryMode === "dirichlet" ? Math.sin(argument) : Math.cos(argument);
}

function sortModeTriplet(mode: SphericalMode): SphericalMode {
  return mode.slice().sort((left, right) => left - right) as SphericalMode;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
