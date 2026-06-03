import { fftRadix2 } from "./fft";
import type { AudioAnalysis, AudioFeatureFrame, FrequencyBand } from "../types";

const ANALYSIS_FPS = 60;
const FFT_SIZE = 1024;
const EPSILON = 0.000_001;
const BANDS: Record<FrequencyBand, [number, number]> = {
  low: [20, 250],
  mid: [250, 2_000],
  high: [2_000, 8_000],
};

type RawFrame = Omit<AudioFeatureFrame, "onsets">;

export async function decodeAndAnalyzeAudio(
  arrayBuffer: ArrayBuffer,
): Promise<AudioAnalysis> {
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
  const context = new AudioContextCtor();

  try {
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    return analyzeAudioBuffer(audioBuffer);
  } finally {
    void context.close();
  }
}

function analyzeAudioBuffer(audioBuffer: AudioBuffer): AudioAnalysis {
  const mono = downmixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const frameCount = Math.max(1, Math.floor(duration * ANALYSIS_FPS));
  const window = createHannWindow(FFT_SIZE);
  const rawFrames: RawFrame[] = [];
  const real = new Float32Array(FFT_SIZE);
  const imaginary = new Float32Array(FFT_SIZE);

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / ANALYSIS_FPS;
    const centerSample = Math.floor(time * sampleRate);
    const startSample = centerSample - Math.floor(FFT_SIZE / 2);
    let squareSum = 0;

    real.fill(0);
    imaginary.fill(0);

    for (let offset = 0; offset < FFT_SIZE; offset += 1) {
      const sampleIndex = startSample + offset;
      const sample =
        sampleIndex >= 0 && sampleIndex < mono.length ? mono[sampleIndex] : 0;
      const windowed = sample * window[offset];
      real[offset] = windowed;
      squareSum += sample * sample;
    }

    fftRadix2(real, imaginary);
    rawFrames.push(
      extractFrame(index, time, Math.sqrt(squareSum / FFT_SIZE), real, imaginary, sampleRate),
    );
  }

  return {
    duration,
    sampleRate,
    frames: addOnsets(rawFrames),
  };
}

function downmixToMono(audioBuffer: AudioBuffer) {
  const mono = new Float32Array(audioBuffer.length);
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );

  for (let index = 0; index < audioBuffer.length; index += 1) {
    let sample = 0;
    for (const channel of channels) {
      sample += channel[index];
    }
    mono[index] = sample / Math.max(1, channels.length);
  }

  return mono;
}

function createHannWindow(size: number) {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

function extractFrame(
  index: number,
  time: number,
  rms: number,
  real: Float32Array,
  imaginary: Float32Array,
  sampleRate: number,
): RawFrame {
  const bands: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };
  const bandCounts: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };
  let weightedFrequency = 0;
  let magnitudeSum = 0;

  for (let bin = 1; bin < FFT_SIZE / 2; bin += 1) {
    const frequency = (bin * sampleRate) / FFT_SIZE;
    const magnitude = Math.hypot(real[bin], imaginary[bin]) / FFT_SIZE;
    const power = magnitude * magnitude;
    weightedFrequency += frequency * magnitude;
    magnitudeSum += magnitude;

    for (const band of Object.keys(BANDS) as FrequencyBand[]) {
      const [minFrequency, maxFrequency] = BANDS[band];
      if (frequency >= minFrequency && frequency < maxFrequency) {
        bands[band] += power;
        bandCounts[band] += 1;
      }
    }
  }

  for (const band of Object.keys(BANDS) as FrequencyBand[]) {
    bands[band] = Math.sqrt(bands[band] / Math.max(1, bandCounts[band])) * 12;
  }

  return {
    index,
    time,
    rms: Math.min(1, rms * 2.4),
    centroid:
      magnitudeSum > EPSILON
        ? Math.min(1, weightedFrequency / magnitudeSum / (sampleRate * 0.5))
        : 0,
    bands,
  };
}

function addOnsets(rawFrames: RawFrame[]): AudioFeatureFrame[] {
  const previous: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };
  const adaptiveFlux: Record<FrequencyBand, number> = {
    low: EPSILON,
    mid: EPSILON,
    high: EPSILON,
  };

  return rawFrames.map((frame) => {
    const onsets: Record<FrequencyBand, number> = { low: 0, mid: 0, high: 0 };

    for (const band of Object.keys(BANDS) as FrequencyBand[]) {
      const flux = Math.max(0, frame.bands[band] - previous[band]);
      adaptiveFlux[band] = adaptiveFlux[band] * 0.94 + flux * 0.06;
      onsets[band] = Math.max(
        0,
        Math.min(1, (flux - adaptiveFlux[band] * 1.35) / (adaptiveFlux[band] * 3.2 + EPSILON)),
      );
      previous[band] = frame.bands[band];
    }

    return { ...frame, onsets };
  });
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
