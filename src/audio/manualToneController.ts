import type { AudioOutputState } from "./audioOutputState.ts";

const DEFAULT_FREQUENCY = 440;
const FADE_SECONDS = 0.025;
const FREQUENCY_TIME_CONSTANT = 0.012;
const GAIN_TIME_CONSTANT = 0.01;

type AudioContextConstructor = new () => AudioContext;

export class ManualToneController {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private outputState: AudioOutputState = {
    volume: 1,
    muted: false,
    lastAudibleVolume: 1,
  };
  private frequency = DEFAULT_FREQUENCY;
  private playing = false;

  isPlaying() {
    return this.playing;
  }

  async play() {
    if (this.playing) {
      return;
    }

    const context = this.getContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(this.frequency, context.currentTime);
    gain.gain.setValueAtTime(0, context.currentTime);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();

    this.oscillator = oscillator;
    this.gain = gain;
    this.playing = true;
    this.applyGain();

    try {
      if (context.state === "suspended") {
        await context.resume();
      }
    } catch (error) {
      this.pause();
      throw error;
    }
  }

  pause() {
    if (!this.playing) {
      return;
    }

    const context = this.context;
    const oscillator = this.oscillator;
    const gain = this.gain;
    this.oscillator = null;
    this.gain = null;
    this.playing = false;

    if (!context || !oscillator || !gain) {
      return;
    }

    const now = context.currentTime;
    const stopAt = now + FADE_SECONDS;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, stopAt);
    oscillator.stop(stopAt + 0.005);
    oscillator.addEventListener(
      "ended",
      () => {
        oscillator.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
  }

  setFrequency(frequency: number) {
    this.frequency = Math.max(1, frequency);
    if (!this.context || !this.oscillator) {
      return;
    }

    this.oscillator.frequency.setTargetAtTime(
      this.frequency,
      this.context.currentTime,
      FREQUENCY_TIME_CONSTANT,
    );
  }

  setVolumeState(state: AudioOutputState) {
    this.outputState = state;
    this.applyGain();
  }

  dispose() {
    this.pause();
    void this.context?.close();
    this.context = null;
  }

  private getContext() {
    if (this.context) {
      return this.context;
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: AudioContextConstructor })
        .webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio is not available in this browser");
    }

    this.context = new AudioContextClass();
    return this.context;
  }

  private applyGain() {
    if (!this.context || !this.gain) {
      return;
    }

    const volume =
      this.outputState.muted || this.outputState.volume <= 0
        ? 0
        : this.outputState.volume;
    this.gain.gain.setTargetAtTime(
      volume,
      this.context.currentTime,
      GAIN_TIME_CONSTANT,
    );
  }
}
