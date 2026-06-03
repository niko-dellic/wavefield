import { ANALYSIS_FPS, FFT_SIZE, createHannWindow } from "./analyze.ts";
import { fftRadix2 } from "./fft.ts";
import {
  AudioTemporalFeatureTracker,
  extractSpectrumFrame,
} from "./featureAnalysis.ts";
import type { AudioFeatureFrame } from "../types.ts";

export class LiveAudioAnalyzer {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly temporalTracker = new AudioTemporalFeatureTracker();
  private readonly window = createHannWindow(FFT_SIZE);
  private readonly timeDomain = new Float32Array(FFT_SIZE);
  private readonly real = new Float32Array(FFT_SIZE);
  private readonly imaginary = new Float32Array(FFT_SIZE);
  private readonly magnitudes = new Float32Array(FFT_SIZE / 2);
  private frameIndex = 0;
  private lastFrame: AudioFeatureFrame | null = null;
  private lastFrameTime = Number.NEGATIVE_INFINITY;

  get isActive() {
    return Boolean(this.analyser && this.context?.state !== "closed");
  }

  async start() {
    if (this.isActive) {
      await this.context?.resume();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone input is not available in this browser");
    }

    this.stop();

    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    const context = new AudioContextCtor();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    this.context = context;
    this.stream = stream;
    this.source = source;
    this.analyser = analyser;
    this.reset();
  }

  stop() {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    if (this.context && this.context.state !== "closed") {
      void this.context.close();
    }
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.reset();
  }

  getFrame(time: number): AudioFeatureFrame | null {
    if (!this.analyser || !this.context) {
      return null;
    }

    const minFrameSpacing = 1 / ANALYSIS_FPS;
    if (this.lastFrame && time - this.lastFrameTime < minFrameSpacing) {
      return this.lastFrame;
    }

    this.analyser.getFloatTimeDomainData(this.timeDomain);
    this.real.fill(0);
    this.imaginary.fill(0);

    let squareSum = 0;
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const sample = this.timeDomain[index] ?? 0;
      this.real[index] = sample * this.window[index];
      squareSum += sample * sample;
    }

    fftRadix2(this.real, this.imaginary);
    for (let bin = 0; bin < this.magnitudes.length; bin += 1) {
      this.magnitudes[bin] =
        Math.hypot(this.real[bin], this.imaginary[bin]) / FFT_SIZE;
    }

    const rawFrame = extractSpectrumFrame({
      index: this.frameIndex,
      time,
      rms: Math.sqrt(squareSum / FFT_SIZE),
      magnitudes: this.magnitudes,
      sampleRate: this.context.sampleRate,
      fftSize: FFT_SIZE,
    });
    const frame = this.temporalTracker.update(rawFrame);

    this.frameIndex += 1;
    this.lastFrame = frame;
    this.lastFrameTime = time;

    return frame;
  }

  private reset() {
    this.temporalTracker.reset();
    this.frameIndex = 0;
    this.lastFrame = null;
    this.lastFrameTime = Number.NEGATIVE_INFINITY;
  }
}
