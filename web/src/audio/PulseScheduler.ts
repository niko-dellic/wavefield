import {
  BAND_COLORS,
  type AudioAnalysis,
  type AudioFeatureFrame,
  type CymaticSettings,
  type FrequencyBand,
  type PulseBurst,
} from "../types";

const BANDS: FrequencyBand[] = ["low", "mid", "high"];
const BAND_OFFSETS: Record<FrequencyBand, number> = {
  low: -1,
  mid: 0,
  high: 1,
};
const BAND_SCALE_KEYS: Record<
  FrequencyBand,
  "lowScale" | "midScale" | "highScale"
> = {
  low: "lowScale",
  mid: "midScale",
  high: "highScale",
};

export class PulseScheduler {
  private analysis: AudioAnalysis | null = null;
  private nextFrameIndex = 0;
  private lastTime = 0;

  setAnalysis(analysis: AudioAnalysis | null) {
    this.analysis = analysis;
    this.reset(0);
  }

  reset(time: number) {
    this.nextFrameIndex = this.findFrameIndex(time);
    this.lastTime = time;
  }

  collect(time: number, settings: CymaticSettings): PulseBurst[] {
    if (!this.analysis) {
      return [];
    }

    if (time + 0.05 < this.lastTime || Math.abs(time - this.lastTime) > 1.25) {
      this.reset(time);
      return [];
    }

    const bursts: PulseBurst[] = [];
    const frames = this.analysis.frames;

    while (
      this.nextFrameIndex < frames.length &&
      frames[this.nextFrameIndex].time <= time
    ) {
      const frame = frames[this.nextFrameIndex];
      for (const band of BANDS) {
        const burst = this.createBurst(frame, band, settings);
        if (burst) {
          bursts.push(burst);
        }
      }

      this.nextFrameIndex += 1;
    }

    this.lastTime = time;
    return bursts.slice(-12);
  }

  private findFrameIndex(time: number) {
    if (!this.analysis) {
      return 0;
    }

    const frames = this.analysis.frames;
    let low = 0;
    let high = frames.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle].time < time) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  private createBurst(
    frame: AudioFeatureFrame,
    band: FrequencyBand,
    settings: CymaticSettings,
  ): PulseBurst | null {
    const bandScale = settings[BAND_SCALE_KEYS[band]];
    const score = frame.onsets[band] * settings.sensitivity * bandScale;
    if (score < 0.14) {
      return null;
    }

    const intensity = clamp(score * settings.gain * (0.72 + frame.bands[band] * 0.38), 0.08, 1.45);
    const radiusBias = band === "low" ? 0.12 : band === "mid" ? 0.05 : 0;
    const centerX =
      settings.originMode === "split"
        ? 0.5 + BAND_OFFSETS[band] * clamp(settings.sourceSpread, 0, 0.34)
        : 0.5;

    return {
      centerUv: [centerX, 0.5],
      reachRadius: clamp(0.2 + intensity * 0.58 + frame.rms * 0.24 + radiusBias, 0.12, 1.18),
      edgeRadius: clamp(0.025 + intensity * 0.06, 0.02, 0.14),
      intensity,
      phaseSeed: hash(frame.index * 17.17 + BANDS.indexOf(band) * 51.31),
      color: BAND_COLORS[band],
    };
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hash(value: number) {
  return Math.abs(Math.sin(value * 12.9898) * 43_758.5453) % 1;
}
