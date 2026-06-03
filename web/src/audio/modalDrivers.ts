import type { AudioFeatureFrame, CymaticSettings } from "../types";
import { getManualFrequency } from "./fieldSources.ts";
import {
  getAtlasModeByKey,
  getAtlasModeForFrequency,
  getNearestAtlasModes,
} from "./modalAtlas.ts";
import {
  clamp01,
  frequencyFromCentroid,
  getBandForFrequency,
  getFrequencyAffinity,
} from "./modalMath.ts";
import {
  HARMONIC_DRIVER_WEIGHTS,
  MAX_FREQUENCY,
  type ModalAtlasEntry,
  type ModeDriver,
  type PersistentDriver,
} from "./modalTypes.ts";

export function resolveModeDrivers(
  frame: AudioFeatureFrame,
  settings: CymaticSettings,
  time: number,
) {
  const drivers = new Map<string, ModeDriver>();
  if (settings.driveMode === "manual") {
    const frequency = getManualFrequency(settings, time);
    const mode = getAtlasModeForFrequency(frequency);
    addModeDriver(drivers, mode, {
      strength: 1,
      pulse: 0.38,
      layer: 0,
      frequency,
      harmonicWeight: 1,
    });
    return drivers;
  }

  const peaks = frame.peaks.length
    ? frame.peaks
    : [
        {
          frequency: frequencyFromCentroid(frame.centroid),
          amplitude: frame.rms,
          harmonicWeight: frame.signals.harmonicity,
          band: getBandForFrequency(frequencyFromCentroid(frame.centroid)),
          bin: 0,
          pitchClass: 0,
        },
      ];

  peaks.slice(0, 6).forEach((peak, peakIndex) => {
    HARMONIC_DRIVER_WEIGHTS.forEach((harmonicWeight, harmonicIndex) => {
      const harmonicOrder = harmonicIndex + 1;
      const targetFrequency = peak.frequency * harmonicOrder;
      if (targetFrequency > MAX_FREQUENCY * 1.25) {
        return;
      }

      const familyCount = harmonicIndex === 0 && peakIndex < 3 ? 2 : 1;
      const layer = harmonicIndex === 0 && peakIndex < 3 ? 0 : 1;
      const primaryMode = getAtlasModeForFrequency(targetFrequency);
      const candidates = [primaryMode, ...getNearestAtlasModes(targetFrequency, familyCount + 2)]
        .filter(
          (mode, index, modes) =>
            modes.findIndex((candidate) => candidate.key === mode.key) === index,
        );

      candidates.slice(0, familyCount).forEach((mode, familyIndex) => {
        const affinity = getFrequencyAffinity(mode.naturalFrequency, targetFrequency);
        const familyWeight = familyIndex === 0 ? 1 : 0.72;
        const strength =
          peak.amplitude *
          harmonicWeight *
          familyWeight *
          affinity *
          (0.74 + peak.harmonicWeight * 0.36) *
          (peakIndex === 0 ? 1 : 0.88 / (peakIndex + 1));
        addModeDriver(drivers, mode, {
          strength,
          pulse: clamp01(
            frame.signals.pulse * (0.26 + harmonicIndex * 0.12) +
              frame.onsets[mode.band] * 0.48 +
              frame.signals.change * (layer ? 0.38 : 0.16),
          ),
          layer,
          frequency: targetFrequency,
          harmonicWeight: peak.harmonicWeight,
        });
      });
    });
  });

  if (!drivers.size) {
    const fallbackFrequency = frequencyFromCentroid(frame.centroid);
    for (const mode of getNearestAtlasModes(fallbackFrequency, 4)) {
      addModeDriver(drivers, mode, {
        strength: frame.rms * 0.32,
        pulse: frame.signals.pulse * 0.4,
        layer: 0,
        frequency: fallbackFrequency,
        harmonicWeight: frame.signals.harmonicity,
      });
    }
  }

  return drivers;
}

export function addModeDriver(
  drivers: Map<string, ModeDriver>,
  mode: ModalAtlasEntry,
  driver: ModeDriver,
) {
  if (driver.strength <= 0.0001) {
    return;
  }

  const existing = drivers.get(mode.key);
  if (!existing) {
    drivers.set(mode.key, {
      ...driver,
      strength: clamp01(driver.strength),
      pulse: clamp01(driver.pulse),
    });
    return;
  }

  existing.strength = clamp01(existing.strength + driver.strength * 0.72);
  existing.pulse = Math.max(existing.pulse, driver.pulse);
  existing.harmonicWeight = Math.max(existing.harmonicWeight, driver.harmonicWeight);
  if (driver.layer < existing.layer || driver.strength > existing.strength * 0.9) {
    existing.layer = driver.layer;
    existing.frequency = driver.frequency;
  }
}

export function getDominantPatternDriver(
  drivers: Map<string, ModeDriver>,
  frame: AudioFeatureFrame,
) {
  let best:
    | {
        frequency: number;
        confidence: number;
      }
    | null = null;

  for (const driver of drivers.values()) {
    if (driver.layer > 0.5) {
      continue;
    }
    const confidence =
      driver.strength *
      (0.72 + driver.harmonicWeight * 0.24 + frame.signals.structure * 0.2);
    if (!best || confidence > best.confidence) {
      best = {
        frequency: driver.frequency,
        confidence,
      };
    }
  }

  if (best) {
    return best;
  }

  const peak = frame.peaks[0];
  if (!peak) {
    return {
      frequency: frequencyFromCentroid(frame.centroid),
      confidence: frame.rms * 0.22 + frame.signals.structure * 0.08,
    };
  }

  return {
    frequency: peak.frequency,
    confidence:
      peak.amplitude *
      (0.54 + peak.harmonicWeight * 0.28 + frame.signals.structure * 0.18),
  };
}

export function updatePersistentDrivers({
  persistentDrivers,
  targets,
  settings,
  time,
  deltaSeconds,
}: {
  persistentDrivers: Map<string, PersistentDriver>;
  targets: Map<string, ModeDriver>;
  settings: CymaticSettings;
  time: number;
  deltaSeconds: number;
}) {
  const morphSeconds = Math.max(0.05, settings.morphSeconds);
  const morphAlpha = 1 - Math.exp(-deltaSeconds / morphSeconds);
  const pulseDecay = Math.exp(-deltaSeconds / Math.max(0.08, morphSeconds * 0.42));

  for (const driver of persistentDrivers.values()) {
    driver.targetStrength = 0;
    driver.pulse *= pulseDecay;
  }

  for (const [key, target] of targets) {
    const existing = persistentDrivers.get(key);
    if (!existing) {
      persistentDrivers.set(key, {
        strength: 0,
        targetStrength: clamp01(target.strength),
        pulse: clamp01(target.pulse),
        layer: target.layer,
        frequency: target.frequency,
        harmonicWeight: target.harmonicWeight,
        lastSeen: time,
      });
      continue;
    }

    existing.targetStrength = clamp01(target.strength);
    existing.pulse = Math.max(existing.pulse, target.pulse);
    existing.layer = target.layer;
    existing.frequency = target.frequency;
    existing.harmonicWeight = target.harmonicWeight;
    existing.lastSeen = time;
  }

  for (const [key, driver] of persistentDrivers) {
    driver.strength += (driver.targetStrength - driver.strength) * morphAlpha;
    if (
      driver.strength < 0.0008 &&
      driver.targetStrength <= 0.0008 &&
      time - driver.lastSeen > morphSeconds * 2.5
    ) {
      persistentDrivers.delete(key);
    }
  }
}

export function materializePersistentDrivers(
  persistentDrivers: Map<string, PersistentDriver>,
) {
  const drivers = new Map<string, ModeDriver>();
  for (const [key, driver] of persistentDrivers) {
    if (driver.strength <= 0.0008 && driver.targetStrength <= 0.0008) {
      continue;
    }
    drivers.set(key, {
      strength: clamp01(driver.strength),
      pulse: clamp01(driver.pulse),
      layer: driver.layer,
      frequency: driver.frequency,
      harmonicWeight: driver.harmonicWeight,
    });
  }

  return drivers;
}

export { getAtlasModeByKey };
