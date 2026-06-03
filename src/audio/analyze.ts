import { fftRadix2 } from "./fft";
import {
  addTemporalFeatures,
  extractSpectrumFrame,
  type RawAudioFeatureFrame,
} from "./featureAnalysis";
import type { AudioAnalysis } from "../types";

export const ANALYSIS_FPS = 60;
export const FFT_SIZE = 1024;

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
  const rawFrames: RawAudioFeatureFrame[] = [];
  const real = new Float32Array(FFT_SIZE);
  const imaginary = new Float32Array(FFT_SIZE);
  const magnitudes = new Float32Array(FFT_SIZE / 2);

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
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      magnitudes[bin] = Math.hypot(real[bin], imaginary[bin]) / FFT_SIZE;
    }
    rawFrames.push(
      extractSpectrumFrame({
        index,
        time,
        rms: Math.sqrt(squareSum / FFT_SIZE),
        magnitudes,
        sampleRate,
        fftSize: FFT_SIZE,
      }),
    );
  }

  return {
    duration,
    sampleRate,
    frames: addTemporalFeatures(rawFrames),
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

export function createHannWindow(size: number) {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
