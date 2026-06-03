import {
  BAND_COLORS,
  type AudioAnalysis,
  type AudioFeatureFrame,
  type CymaticSettings,
  type FrequencyBand,
} from "../types";

export const MAX_MODAL_MODES = 32;

export type ModalSlot = {
  indices: [number, number, number];
  amplitude: number;
  phase: number;
  coherence: number;
  frequencyNorm: number;
  band: FrequencyBand;
  color: [number, number, number];
  colorWeight: number;
};

export type ModalFieldFrame = {
  modes: ModalSlot[];
  rms: number;
  centroid: number;
  flux: number;
  bands: Record<FrequencyBand, number>;
};

type ModalAtlasEntry = {
  key: string;
  indices: [number, number, number];
  naturalFrequency: number;
  frequencyNorm: number;
  band: FrequencyBand;
};

type ModalState = ModalAtlasEntry & {
  amplitude: number;
  phase: number;
  coherence: number;
  lastDrive: number;
};

const BANDS: FrequencyBand[] = ["low", "mid", "high"];
const BAND_SCALE_KEYS: Record<
  FrequencyBand,
  "lowScale" | "midScale" | "highScale"
> = {
  low: "lowScale",
  mid: "midScale",
  high: "highScale",
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 7_200;
const ATLAS_SIZE = 48;

export class ModalFieldEngine {
  private analysis: AudioAnalysis | null = null;
  private readonly modes: ModalState[];
  private lastTime = 0;
  private previousFrame: AudioFeatureFrame | null = null;
  private idlePhase = 0;

  constructor() {
    this.modes = buildModalAtlas().map((entry) => ({
      ...entry,
      amplitude: 0,
      phase: hashMode(entry.indices) * Math.PI * 2,
      coherence: 0,
      lastDrive: 0,
    }));
  }

  setAnalysis(analysis: AudioAnalysis | null) {
    this.analysis = analysis;
    this.reset(0);
  }

  reset(time: number) {
    this.lastTime = time;
    this.previousFrame = this.getFrameAt(time);
    for (const mode of this.modes) {
      mode.amplitude = 0;
      mode.coherence = 0;
      mode.lastDrive = 0;
    }
  }

  update(
    time: number,
    settings: CymaticSettings,
    deltaSeconds: number,
  ): ModalFieldFrame {
    if (time + 0.05 < this.lastTime || Math.abs(time - this.lastTime) > 1.25) {
      this.reset(time);
    }

    const safeDelta = clamp(deltaSeconds, 0, 0.1);
    const frame = this.getFrameAt(time) ?? this.createIdleFrame(time);
    const previousFrame = this.previousFrame ?? frame;
    const flux = Math.max(
      0,
      frame.bands.low -
        previousFrame.bands.low +
        frame.bands.mid -
        previousFrame.bands.mid +
        frame.bands.high -
        previousFrame.bands.high,
    );
    const targetFrequency = frequencyFromCentroid(frame.centroid);
    const sourcePoint = [
      clamp(settings.sourceX, 0.05, 0.95),
      clamp(settings.sourceY, 0.05, 0.95),
      0.5,
    ] as const;
    const boundaryMode = settings.boundaryMode;

    for (const mode of this.modes) {
      const bandScale = settings[BAND_SCALE_KEYS[mode.band]];
      const bandEnergy = frame.bands[mode.band];
      const onset = frame.onsets[mode.band];
      const frequencyAffinity = getFrequencyAffinity(
        mode.naturalFrequency,
        targetFrequency,
      );
      const sourceWeight = Math.max(
        0.18,
        Math.abs(
          evaluateModeAtPoint(mode.indices, sourcePoint, boundaryMode),
        ),
      );
      const drive = clamp01(
        (bandEnergy * 0.5 +
          onset * 0.86 +
          frame.rms * 0.24 +
          frequencyAffinity * frame.centroid * 0.18) *
          settings.gain *
          settings.sensitivity *
          settings.modalDrive *
          bandScale *
          sourceWeight,
      );
      const decaySeconds =
        settings.modalDecay *
        (mode.band === "low" ? 1.28 : mode.band === "mid" ? 1 : 0.72);
      const decay = Math.exp(-safeDelta / Math.max(0.08, decaySeconds));
      const injection = drive * (0.22 + onset * 0.18 + frame.rms * 0.08);
      const nextAmplitude =
        mode.amplitude * decay + injection * (1 - mode.amplitude * 0.48);
      const coherenceTarget = clamp01(
        frequencyAffinity * 0.58 +
          bandEnergy * 0.22 +
          onset * 0.16 +
          frame.rms * 0.08,
      );

      mode.amplitude = clamp01(nextAmplitude);
      mode.coherence +=
        (coherenceTarget - mode.coherence) *
        (1 - Math.exp(-safeDelta * (drive > mode.lastDrive ? 9 : 3.6)));
      mode.phase +=
        safeDelta *
        (0.42 + mode.frequencyNorm * 4.2 + frame.rms * 1.4 + onset * 1.2);
      mode.lastDrive = drive;
    }

    this.previousFrame = frame;
    this.lastTime = time;

    return {
      modes: this.modes
        .filter((mode) => mode.amplitude > 0.002)
        .sort(
          (left, right) =>
            right.amplitude * (0.28 + right.coherence) -
            left.amplitude * (0.28 + left.coherence),
        )
        .slice(0, Math.min(MAX_MODAL_MODES, Math.max(1, settings.modalCount)))
        .map((mode) => ({
          indices: mode.indices,
          amplitude: mode.amplitude,
          phase: mode.phase,
          coherence: mode.coherence,
          frequencyNorm: mode.frequencyNorm,
          band: mode.band,
          color: createModeColor(mode.naturalFrequency, mode.band),
          colorWeight: clamp01(mode.amplitude * 0.58 + mode.coherence * 0.42),
        })),
      rms: frame.rms,
      centroid: frame.centroid,
      flux: clamp01(flux * 1.5),
      bands: frame.bands,
    };
  }

  private getFrameAt(time: number): AudioFeatureFrame | null {
    if (!this.analysis?.frames.length) {
      return null;
    }

    const frames = this.analysis.frames;
    let low = 0;
    let high = frames.length - 1;

    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (frames[middle].time <= time) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return frames[low] ?? null;
  }

  private createIdleFrame(time: number): AudioFeatureFrame {
    this.idlePhase += Math.max(0, time - this.lastTime) * 0.8;
    const shimmer = 0.5 + 0.5 * Math.sin(this.idlePhase);

    return {
      index: 0,
      time,
      rms: 0.32 + shimmer * 0.06,
      centroid: 0.36 + shimmer * 0.08,
      bands: {
        low: 0.22 + shimmer * 0.06,
        mid: 0.34 + shimmer * 0.08,
        high: 0.16 + shimmer * 0.05,
      },
      onsets: {
        low: 0.07,
        mid: 0.1 + shimmer * 0.04,
        high: 0.055,
      },
    };
  }
}

function buildModalAtlas(): ModalAtlasEntry[] {
  const candidates = new Map<string, ModalAtlasEntry>();
  const targetFrequencies = buildFrequencyCenters(
    MIN_FREQUENCY,
    MAX_FREQUENCY,
    ATLAS_SIZE,
  );
  const rawCandidates: ModalAtlasEntry[] = [];

  for (let u = 1; u <= 18; u += 1) {
    for (let v = 1; v <= 18; v += 1) {
      for (let w = 1; w <= 6; w += 1) {
        const magnitude = Math.hypot(u, v, w);
        const naturalFrequency = 55 * Math.pow(magnitude, 1.38);
        const key = `${u}:${v}:${w}`;
        rawCandidates.push({
          key,
          indices: [u, v, w],
          naturalFrequency,
          frequencyNorm: clamp01(
            (Math.log2(naturalFrequency) - Math.log2(MIN_FREQUENCY)) /
              (Math.log2(MAX_FREQUENCY) - Math.log2(MIN_FREQUENCY)),
          ),
          band: getBandForFrequency(naturalFrequency),
        });
      }
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

  return Array.from(candidates.values()).sort(
    (left, right) => left.naturalFrequency - right.naturalFrequency,
  );
}

function buildFrequencyCenters(min: number, max: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    return min * Math.pow(max / min, t);
  });
}

function getBandForFrequency(frequency: number): FrequencyBand {
  if (frequency < 250) {
    return "low";
  }

  if (frequency < 2_000) {
    return "mid";
  }

  return "high";
}

function frequencyFromCentroid(centroid: number) {
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, clamp01(centroid));
}

function getFrequencyAffinity(frequency: number, target: number) {
  const distance = Math.abs(Math.log2(frequency / Math.max(1, target)));
  return Math.exp(-distance * 1.55);
}

function evaluateModeAtPoint(
  indices: [number, number, number],
  point: readonly [number, number, number],
  boundaryMode: "dirichlet" | "neumann",
) {
  return (
    basis(indices[0], point[0], boundaryMode) *
    basis(indices[1], point[1], boundaryMode) *
    basis(indices[2], point[2], boundaryMode)
  );
}

function basis(index: number, coordinate: number, boundaryMode: "dirichlet" | "neumann") {
  const argument = Math.PI * index * coordinate;
  return boundaryMode === "dirichlet" ? Math.sin(argument) : Math.cos(argument);
}

function createModeColor(frequency: number, band: FrequencyBand): [number, number, number] {
  const pitchClass = mod(Math.round(69 + 12 * Math.log2(frequency / 440)), 12);
  const octave = clamp((Math.log2(frequency / 55) - 1) / 7, 0, 1);
  const hue = pitchClass / 12;
  const saturation = 0.48 + octave * 0.18;
  const value = 0.68 + octave * 0.26;
  const chroma = hsvToRgb(hue, saturation, value);
  const bandColor = BAND_COLORS[band];

  return [
    chroma[0] * 0.78 + bandColor[0] * 0.22,
    chroma[1] * 0.78 + bandColor[1] * 0.22,
    chroma[2] * 0.78 + bandColor[2] * 0.22,
  ];
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = mod(hue, 1) * 6;
  const sector = Math.floor(h);
  const fraction = h - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);

  switch (sector % 6) {
    case 0:
      return [value, t, p];
    case 1:
      return [q, value, p];
    case 2:
      return [p, value, t];
    case 3:
      return [p, q, value];
    case 4:
      return [t, p, value];
    default:
      return [value, p, q];
  }
}

function hashMode(indices: [number, number, number]) {
  return (
    Math.abs(
      Math.sin(indices[0] * 12.9898 + indices[1] * 78.233 + indices[2] * 37.719) *
        43_758.5453,
    ) % 1
  );
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mod(value: number, base: number) {
  return ((value % base) + base) % base;
}
