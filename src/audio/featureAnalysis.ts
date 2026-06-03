import type {
  AudioFeatureFrame,
  AudioFeatureSignals,
  ChromaProfile,
  FrequencyBand,
  SpectralPeak,
} from "../types";

export const AUDIO_BANDS: Record<FrequencyBand, [number, number]> = {
  low: [20, 250],
  mid: [250, 2_000],
  high: [2_000, 8_000],
};

export const EMPTY_CHROMA_PROFILE: ChromaProfile = {
  bins: Array.from({ length: 12 }, () => 0),
  tonic: 0,
  confidence: 0,
  color: [0.86, 0.96, 1],
};

export const EMPTY_FEATURE_SIGNALS: AudioFeatureSignals = {
  structure: 0,
  energy: 0,
  change: 0,
  pulse: 0,
  beat: 0,
  beatConfidence: 0,
  harmonicity: 0,
  texture: 0,
};

export type SpectrumFrameInput = {
  index: number;
  time: number;
  rms: number;
  magnitudes: Float32Array;
  sampleRate: number;
  fftSize: number;
};

export type RawAudioFeatureFrame = Omit<
  AudioFeatureFrame,
  "onsets" | "signals" | "spectralFlux"
> & {
  spectralEnergy: number;
};

const EPSILON = 0.000_001;
const PEAK_COUNT = 8;
const PEAK_MIN_GAP_HZ = 58;
const PEAK_MIN_FREQUENCY = 45;
const PEAK_MAX_FREQUENCY = 8_000;
const HARMONIC_ORDERS = [2, 3, 4, 5];

export function extractSpectrumFrame({
  index,
  time,
  rms,
  magnitudes,
  sampleRate,
  fftSize,
}: SpectrumFrameInput): RawAudioFeatureFrame {
  const bands: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };
  const bandCounts: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };
  let weightedFrequency = 0;
  let magnitudeSum = 0;
  let spectralEnergy = 0;

  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const frequency = binToFrequency(bin, sampleRate, fftSize);
    const magnitude = magnitudes[bin];
    const power = magnitude * magnitude;
    weightedFrequency += frequency * magnitude;
    magnitudeSum += magnitude;
    spectralEnergy += power;

    for (const band of Object.keys(AUDIO_BANDS) as FrequencyBand[]) {
      const [minFrequency, maxFrequency] = AUDIO_BANDS[band];
      if (frequency >= minFrequency && frequency < maxFrequency) {
        bands[band] += power;
        bandCounts[band] += 1;
      }
    }
  }

  for (const band of Object.keys(AUDIO_BANDS) as FrequencyBand[]) {
    bands[band] = clamp01(
      Math.sqrt(bands[band] / Math.max(1, bandCounts[band])) * 12,
    );
  }

  const peaks = findSpectralPeaks({
    magnitudes,
    sampleRate,
    fftSize,
    count: PEAK_COUNT,
  });
  const chroma = buildChromaProfile(magnitudes, sampleRate, fftSize);

  return {
    index,
    time,
    rms: clamp01(rms * 2.4),
    centroid:
      magnitudeSum > EPSILON
        ? clamp01(weightedFrequency / magnitudeSum / (sampleRate * 0.5))
        : 0,
    bands,
    peaks,
    chroma,
    spectralEnergy: clamp01(Math.sqrt(spectralEnergy / Math.max(1, magnitudes.length)) * 14),
  };
}

export class AudioTemporalFeatureTracker {
  private previousBands: Record<FrequencyBand, number> = {
    low: 0,
    mid: 0,
    high: 0,
  };
  private adaptiveFlux: Record<FrequencyBand, number> = {
    low: EPSILON,
    mid: EPSILON,
    high: EPSILON,
  };
  private previousFrame: RawAudioFeatureFrame | null = null;
  private beatThreshold = 0.025;
  private previousBeatTime = Number.NEGATIVE_INFINITY;

  reset() {
    this.previousBands = { low: 0, mid: 0, high: 0 };
    this.adaptiveFlux = {
      low: EPSILON,
      mid: EPSILON,
      high: EPSILON,
    };
    this.previousFrame = null;
    this.beatThreshold = 0.025;
    this.previousBeatTime = Number.NEGATIVE_INFINITY;
  }

  update(frame: RawAudioFeatureFrame): AudioFeatureFrame {
    const onsets: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };
    let bandRise = 0;

    for (const band of Object.keys(AUDIO_BANDS) as FrequencyBand[]) {
      const flux = Math.max(0, frame.bands[band] - this.previousBands[band]);
      this.adaptiveFlux[band] = this.adaptiveFlux[band] * 0.94 + flux * 0.06;
      onsets[band] = clamp01(
        (flux - this.adaptiveFlux[band] * 1.35) /
          (this.adaptiveFlux[band] * 3.2 + EPSILON),
      );
      bandRise += flux;
      this.previousBands[band] = frame.bands[band];
    }

    const peakRise = this.previousFrame
      ? getPeakRise(frame.peaks, this.previousFrame.peaks)
      : 0;
    const spectralFlux = clamp01(bandRise * 1.25 + peakRise * 1.7);
    const beatDriver =
      Math.max(0, frame.bands.low - (this.previousFrame?.bands.low ?? 0)) *
        0.72 +
      Math.max(0, frame.bands.mid - (this.previousFrame?.bands.mid ?? 0)) *
        0.28 +
      spectralFlux * 0.22;
    this.beatThreshold = this.beatThreshold * 0.92 + beatDriver * 0.08;
    const beatCooldown = frame.time - this.previousBeatTime > 0.18;
    const beatConfidence = clamp01(
      (beatDriver - this.beatThreshold * 1.18) /
        (this.beatThreshold * 2.2 + EPSILON),
    );
    const beat = beatCooldown && beatConfidence > 0.16 ? beatConfidence : 0;
    if (beat > 0) {
      this.previousBeatTime = frame.time;
    }

    const avgBand = (frame.bands.low + frame.bands.mid + frame.bands.high) / 3;
    const strongestPeak = frame.peaks[0]?.amplitude ?? 0;
    const harmonicity = clamp01(
      frame.peaks.reduce((sum, peak) => sum + peak.harmonicWeight * peak.amplitude, 0) /
        Math.max(EPSILON, frame.peaks.reduce((sum, peak) => sum + peak.amplitude, 0)),
    );
    const tonalStructure = clamp01(
      harmonicity * (0.35 + frame.chroma.confidence * 0.65),
    );
    const texture = clamp01(
      frame.bands.high * 0.56 +
        spectralFlux * 0.34 +
        (1 - frame.chroma.confidence) * 0.22,
    );
    const signals: AudioFeatureSignals = {
      structure: clamp01(
        tonalStructure * 0.56 +
          frame.chroma.confidence * 0.28 +
          strongestPeak * (0.12 + tonalStructure * 0.12),
      ),
      energy: clamp01(frame.rms * 0.42 + avgBand * 0.34 + frame.spectralEnergy * 0.24),
      change: spectralFlux,
      pulse: clamp01(
        beat * 0.72 +
          Math.max(onsets.low * 0.32, onsets.mid * 0.42, onsets.high * 0.5) +
          spectralFlux * 0.22,
      ),
      beat,
      beatConfidence,
      harmonicity,
      texture,
    };
    this.previousFrame = frame;

    return {
      index: frame.index,
      time: frame.time,
      rms: frame.rms,
      centroid: frame.centroid,
      bands: frame.bands,
      onsets,
      peaks: frame.peaks,
      chroma: frame.chroma,
      signals,
      spectralFlux,
    };
  }
}

export function addTemporalFeatures(rawFrames: RawAudioFeatureFrame[]): AudioFeatureFrame[] {
  const tracker = new AudioTemporalFeatureTracker();
  return rawFrames.map((frame) => tracker.update(frame));
}

export function findSpectralPeaks({
  magnitudes,
  sampleRate,
  fftSize,
  count,
  minGapHz = PEAK_MIN_GAP_HZ,
}: {
  magnitudes: Float32Array;
  sampleRate: number;
  fftSize: number;
  count: number;
  minGapHz?: number;
}): SpectralPeak[] {
  const candidates: SpectralPeak[] = [];
  let maxMagnitude = EPSILON;

  for (let bin = 1; bin < magnitudes.length - 1; bin += 1) {
    maxMagnitude = Math.max(maxMagnitude, magnitudes[bin]);
  }

  for (let bin = 1; bin < magnitudes.length - 1; bin += 1) {
    const magnitude = magnitudes[bin];
    if (
      magnitude < maxMagnitude * 0.12 ||
      magnitude < 0.000_08 ||
      magnitude < magnitudes[bin - 1] ||
      magnitude <= magnitudes[bin + 1]
    ) {
      continue;
    }

    const frequency = interpolatePeakFrequency(bin, magnitudes, sampleRate, fftSize);
    if (frequency < PEAK_MIN_FREQUENCY || frequency > PEAK_MAX_FREQUENCY) {
      continue;
    }

    candidates.push({
      bin,
      frequency,
      amplitude: clamp01(magnitude / maxMagnitude),
      band: getBandForFrequency(frequency),
      pitchClass: frequencyToPitchClass(frequency),
      harmonicWeight: 0,
    });
  }

  candidates.sort((left, right) => right.amplitude - left.amplitude);

  const selected: SpectralPeak[] = [];
  for (const candidate of candidates) {
    if (selected.length >= count) {
      break;
    }
    const tooClose = selected.some(
      (peak) => Math.abs(peak.frequency - candidate.frequency) < minGapHz,
    );
    if (!tooClose) {
      selected.push({
        ...candidate,
        harmonicWeight: getHarmonicSupport(candidate.frequency, magnitudes, sampleRate, fftSize),
      });
    }
  }

  return selected.sort((left, right) => {
    if (Math.abs(right.amplitude - left.amplitude) > 0.02) {
      return right.amplitude - left.amplitude;
    }
    return left.frequency - right.frequency;
  });
}

export function buildChromaProfile(
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
): ChromaProfile {
  const bins = Array.from({ length: 12 }, () => 0);
  let total = 0;

  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const frequency = binToFrequency(bin, sampleRate, fftSize);
    if (frequency < 55 || frequency > 5_000) {
      continue;
    }

    const magnitude = magnitudes[bin];
    const pitchClass = frequencyToPitchClass(frequency);
    const weight = magnitude * (0.6 + Math.min(1, frequency / 800) * 0.4);
    bins[pitchClass] += weight;
    total += weight;
  }

  if (total <= EPSILON) {
    return {
      bins: [...EMPTY_CHROMA_PROFILE.bins],
      tonic: EMPTY_CHROMA_PROFILE.tonic,
      confidence: EMPTY_CHROMA_PROFILE.confidence,
      color: [...EMPTY_CHROMA_PROFILE.color],
    };
  }

  let tonic = 0;
  let strongest = 0;
  for (let index = 0; index < bins.length; index += 1) {
    bins[index] /= total;
    if (bins[index] > strongest) {
      strongest = bins[index];
      tonic = index;
    }
  }

  const mean = 1 / 12;
  const confidence = clamp01((strongest - mean) / 0.42);
  return {
    bins,
    tonic,
    confidence,
    color: pitchClassToColor(tonic, confidence),
  };
}

export function getBandForFrequency(frequency: number): FrequencyBand {
  if (frequency < 250) {
    return "low";
  }

  if (frequency < 2_000) {
    return "mid";
  }

  return "high";
}

export function frequencyToPitchClass(frequency: number) {
  return mod(Math.round(69 + 12 * Math.log2(Math.max(1, frequency) / 440)), 12);
}

function getPeakRise(peaks: SpectralPeak[], previousPeaks: SpectralPeak[]) {
  let rise = 0;
  for (const peak of peaks.slice(0, 6)) {
    const previous = previousPeaks.find(
      (candidate) => Math.abs(Math.log2(candidate.frequency / peak.frequency)) < 0.035,
    );
    rise += Math.max(0, peak.amplitude - (previous?.amplitude ?? 0));
  }
  return clamp01(rise / 2.4);
}

function getHarmonicSupport(
  frequency: number,
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
) {
  const fundamental = sampleMagnitudeForFrequency(frequency, magnitudes, sampleRate, fftSize);
  if (fundamental <= EPSILON) {
    return 0;
  }

  let support = 0;
  let weight = 0;
  for (const order of HARMONIC_ORDERS) {
    const harmonicFrequency = frequency * order;
    const harmonic = sampleMagnitudeForFrequency(
      harmonicFrequency,
      magnitudes,
      sampleRate,
      fftSize,
    );
    const orderWeight = 1 / order;
    support += Math.min(1, harmonic / Math.max(EPSILON, fundamental)) * orderWeight;
    weight += orderWeight;
  }

  return clamp01(support / Math.max(EPSILON, weight));
}

function sampleMagnitudeForFrequency(
  frequency: number,
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
) {
  const bin = Math.round((frequency / sampleRate) * fftSize);
  return magnitudes[Math.max(0, Math.min(magnitudes.length - 1, bin))] ?? 0;
}

function interpolatePeakFrequency(
  bin: number,
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
) {
  const left = magnitudes[bin - 1] ?? 0;
  const center = magnitudes[bin] ?? 0;
  const right = magnitudes[bin + 1] ?? 0;
  const denominator = left - 2 * center + right;
  const delta = Math.abs(denominator) > EPSILON ? (0.5 * (left - right)) / denominator : 0;
  return binToFrequency(bin + clamp(delta, -0.5, 0.5), sampleRate, fftSize);
}

function binToFrequency(bin: number, sampleRate: number, fftSize: number) {
  return (bin * sampleRate) / fftSize;
}

function pitchClassToColor(
  pitchClass: number,
  confidence: number,
): [number, number, number] {
  const hue = mod(pitchClass, 12) / 12;
  const saturation = 0.44 + confidence * 0.26;
  const value = 0.74 + confidence * 0.22;
  return hsvToRgb(hue, saturation, value);
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

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mod(value: number, base: number) {
  return ((value % base) + base) % base;
}
