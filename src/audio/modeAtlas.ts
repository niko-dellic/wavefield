import { clampFrequencyNorm } from "./modalMath.ts";
import { getBandForFrequency } from "./featureAnalysis.ts";
import { deriveSphericalModeFromChladniMode } from "./sphericalModes.ts";
import {
  MAX_FREQUENCY,
  MIN_FREQUENCY,
  type ModalAtlasEntry,
} from "./modalTypes.ts";

// Highest spatial mode index. Kept modest so the analytic field stays renderable
// (no aliasing from very high spatial frequencies) while still covering the
// audible range via the plate frequency relation f ∝ (m² + n²).
const MAX_MODE_INDEX = 16;

// Anchor: the (2,3) figure is voiced at 220 Hz. This keeps a recognizable,
// low-order figure near the musical reference pitch while every other mode is
// placed by its eigenvalue, so neighbouring frequencies yield genuinely
// different (m,n) shapes (e.g. (1,3), (2,3), (3,4)) rather than scalar multiples
// of one ratio.
const ANCHOR_MODE: [number, number] = [2, 3];
const ANCHOR_FREQUENCY = 220;
const ANCHOR_EIGENVALUE = eigenvalue(ANCHOR_MODE);

export const MODE_ATLAS = buildModeAtlas();

function buildModeAtlas(): ModalAtlasEntry[] {
  const entries: ModalAtlasEntry[] = [];

  // Only m < n: (n,m) is the same nodal figure mirrored, and m === n collapses
  // to a null field under the free-plate boundary. This guarantees every atlas
  // entry is a distinct, non-degenerate figure.
  for (let m = 1; m < MAX_MODE_INDEX; m += 1) {
    for (let n = m + 1; n <= MAX_MODE_INDEX; n += 1) {
      const mode: [number, number] = [m, n];
      const naturalFrequency =
        (ANCHOR_FREQUENCY * eigenvalue(mode)) / ANCHOR_EIGENVALUE;
      entries.push({
        key: `${m}:${n}`,
        mode,
        sphericalMode: deriveSphericalModeFromChladniMode(mode),
        naturalFrequency,
        frequencyNorm: clampFrequencyNorm(naturalFrequency),
        band: getBandForFrequency(naturalFrequency),
      });
    }
  }

  return entries.sort(
    (left, right) => left.naturalFrequency - right.naturalFrequency,
  );
}

// Plate (Kirchhoff) relation: resonant frequency scales with m² + n².
function eigenvalue(mode: [number, number]) {
  return mode[0] * mode[0] + mode[1] * mode[1];
}

function logDistance(frequency: number, target: number) {
  return Math.abs(
    Math.log2(Math.max(1, frequency) / Math.max(1, target)),
  );
}

// The `count` atlas modes closest to `frequency` in log-frequency space. Ties on
// distance are broken toward lower-order (coarser) figures so the dominant pick
// stays visually clean.
export function nearestModesForFrequency(
  frequency: number,
  count: number,
): ModalAtlasEntry[] {
  return MODE_ATLAS.slice()
    .sort((left, right) => {
      const delta =
        logDistance(left.naturalFrequency, frequency) -
        logDistance(right.naturalFrequency, frequency);
      if (Math.abs(delta) > 1e-6) {
        return delta;
      }
      return (
        left.mode[0] + left.mode[1] - (right.mode[0] + right.mode[1])
      );
    })
    .slice(0, Math.max(1, count));
}

export function atlasModeForFrequency(frequency: number): ModalAtlasEntry {
  return nearestModesForFrequency(frequency, 1)[0];
}

const ATLAS_BY_KEY = new Map(MODE_ATLAS.map((entry) => [entry.key, entry]));

export function getAtlasModeByKey(key: string): ModalAtlasEntry {
  const existing = ATLAS_BY_KEY.get(key);
  if (existing) {
    return existing;
  }

  const [m = ANCHOR_MODE[0], n = ANCHOR_MODE[1]] = key
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  const mode: [number, number] = [m, n];
  const naturalFrequency =
    (ANCHOR_FREQUENCY * eigenvalue(mode)) / ANCHOR_EIGENVALUE;
  return {
    key,
    mode,
    sphericalMode: deriveSphericalModeFromChladniMode(mode),
    naturalFrequency,
    frequencyNorm: clampFrequencyNorm(naturalFrequency),
    band: getBandForFrequency(naturalFrequency),
  };
}

export { MIN_FREQUENCY, MAX_FREQUENCY };
