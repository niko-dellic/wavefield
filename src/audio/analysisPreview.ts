import type { AudioAnalysis } from "../types";

export function getFirstMeaningfulFrameTime(analysis: AudioAnalysis) {
  return (
    analysis.frames.find(
      (frame) =>
        frame.peaks.length > 0 ||
        frame.signals.energy > 0.08 ||
        frame.signals.structure > 0.08,
    )?.time ?? 0
  );
}
