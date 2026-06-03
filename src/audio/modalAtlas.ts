import { mapFrequencyToChladniMode } from "./chladniModes.ts";
import { clampFrequencyNorm, getBandForFrequency } from "./modalMath.ts";
import {
  ATLAS_SIZE,
  MAX_MODAL_MODES,
  MAX_FREQUENCY,
  MIN_FREQUENCY,
  type ModalAtlasEntry,
} from "./modalTypes.ts";

export const MODAL_ATLAS = buildModalAtlas();
export const DISPLAY_MODE_INDEXES = buildDisplayModeIndexes(
  MODAL_ATLAS.length,
  MAX_MODAL_MODES,
);

export function buildModalAtlas(): ModalAtlasEntry[] {
  const candidates = new Map<string, ModalAtlasEntry>();
  const targetFrequencies = buildFrequencyCenters(
    MIN_FREQUENCY,
    MAX_FREQUENCY,
    ATLAS_SIZE,
  );
  const rawCandidates: ModalAtlasEntry[] = [];

  for (let m = 1; m <= 28; m += 1) {
    for (let n = 1; n <= 28; n += 1) {
      const magnitude = Math.hypot(m, n);
      const naturalFrequency = 220 * Math.pow(magnitude / Math.hypot(3, 5), 2);
      const key = `${m}:${n}`;
      rawCandidates.push({
        key,
        mode: [m, n],
        naturalFrequency,
        frequencyNorm: clampFrequencyNorm(naturalFrequency),
        band: getBandForFrequency(naturalFrequency),
      });
    }
  }

  for (const target of targetFrequencies) {
    const nearest = rawCandidates
      .filter((candidate) => !candidates.has(candidate.key))
      .sort(
        (left, right) =>
          Math.abs(Math.log2(left.naturalFrequency / target)) -
          Math.abs(Math.log2(right.naturalFrequency / target)),
      )[0];
    if (nearest) {
      candidates.set(nearest.key, nearest);
    }
  }

  for (const target of [...targetFrequencies, 110, 220, 440, 880, 1_760, 3_520]) {
    const mapped = mapFrequencyToChladniMode(target);
    const key = `${mapped.m}:${mapped.n}`;
    const candidate = rawCandidates.find((entry) => entry.key === key);
    if (candidate) {
      candidates.set(candidate.key, candidate);
    }
  }

  return Array.from(candidates.values()).sort(
    (left, right) => left.naturalFrequency - right.naturalFrequency,
  );
}

export function getNearestAtlasModes(frequency: number, count: number) {
  return MODAL_ATLAS.slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(Math.log2(left.naturalFrequency / frequency));
      const rightDistance = Math.abs(Math.log2(right.naturalFrequency / frequency));
      if (Math.abs(leftDistance - rightDistance) > 0.0001) {
        return leftDistance - rightDistance;
      }
      return left.mode[0] + left.mode[1] - (right.mode[0] + right.mode[1]);
    })
    .slice(0, count);
}

export function getAtlasModeForFrequency(frequency: number) {
  const mapped = mapFrequencyToChladniMode(frequency);
  const direct = MODAL_ATLAS.find(
    (mode) => mode.mode[0] === mapped.m && mode.mode[1] === mapped.n,
  );
  if (direct) {
    return direct;
  }

  return {
    key: `${mapped.m}:${mapped.n}`,
    mode: [mapped.m, mapped.n] as [number, number],
    naturalFrequency: mapped.frequency,
    frequencyNorm: clampFrequencyNorm(mapped.frequency),
    band: getBandForFrequency(mapped.frequency),
  };
}

export function getAtlasModeByKey(key: string) {
  const existing = MODAL_ATLAS.find((mode) => mode.key === key);
  if (existing) {
    return existing;
  }

  const [m = 3, n = 5] = key.split(":").map((part) => Number.parseInt(part, 10));
  const naturalFrequency =
    220 * Math.pow(Math.hypot(m, n) / Math.hypot(3, 5), 2);
  return {
    key,
    mode: [m, n] as [number, number],
    naturalFrequency,
    frequencyNorm: clampFrequencyNorm(naturalFrequency),
    band: getBandForFrequency(naturalFrequency),
  };
}

function buildFrequencyCenters(min: number, max: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    return min * Math.pow(max / min, t);
  });
}

function buildDisplayModeIndexes(sourceCount: number, displayCount: number) {
  if (sourceCount <= displayCount) {
    return Array.from({ length: sourceCount }, (_, index) => index);
  }

  const indexes: number[] = [];
  const used = new Set<number>();
  for (let index = 0; index < displayCount; index += 1) {
    const t = index / Math.max(1, displayCount - 1);
    const sourceIndex = Math.round(t * (sourceCount - 1));
    if (!used.has(sourceIndex)) {
      indexes.push(sourceIndex);
      used.add(sourceIndex);
    }
  }

  for (let index = 0; indexes.length < displayCount && index < sourceCount; index += 1) {
    if (!used.has(index)) {
      indexes.push(index);
      used.add(index);
    }
  }

  return indexes;
}
