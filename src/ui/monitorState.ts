import type { ModalFieldFrame } from "../audio/ModalField";
import type { CymaticSettings } from "../types";
import { formatDriveMode } from "./format";
import type { MonitorState } from "./controls";

export function createInitialMonitorState(): MonitorState {
  return {
    graph: 0,
    reading: "0 Hz",
    drive: "Manual",
    peak: "none",
    base: "none",
    modes: "0/0",
    topology: 0,
    excitation: 0,
    change: 0,
    pulse: 0,
  };
}

export function updateMonitorState(
  monitorState: MonitorState,
  settings: CymaticSettings,
  fieldFrame: ModalFieldFrame,
) {
  const peak = fieldFrame.peaks[0];
  monitorState.drive = formatDriveMode(settings.driveMode);
  monitorState.peak = peak
    ? `${Math.round(peak.frequency)} Hz`
    : fieldFrame.debug.peakSummary;
  monitorState.base =
    fieldFrame.debug.topologyFrequency > 0
      ? `${Math.round(fieldFrame.debug.topologyFrequency)} Hz / ${fieldFrame.debug.topologyMode}`
      : "none";
  monitorState.modes = `${fieldFrame.modes.length}/${fieldFrame.debug.activeModeCount}`;
  monitorState.topology = fieldFrame.signals.topology;
  monitorState.excitation = fieldFrame.debug.excitation;
  monitorState.change = fieldFrame.signals.change;
  monitorState.pulse = fieldFrame.signals.pulse;

  switch (settings.monitorSignal) {
    case "frequency": {
      const frequency =
        fieldFrame.debug.topologyFrequency ||
        fieldFrame.peaks[0]?.frequency ||
        0;
      monitorState.graph =
        frequency > 0
          ? clamp01(
              (Math.log2(frequency) - Math.log2(70)) /
                (Math.log2(7_200) - Math.log2(70)),
            )
          : 0;
      monitorState.reading = `${Math.round(frequency)} Hz`;
      return;
    }
    case "level":
      monitorState.graph = clamp01(fieldFrame.rms);
      monitorState.reading = fieldFrame.rms.toFixed(2);
      return;
    case "excitation":
      monitorState.graph = clamp01(fieldFrame.signals.excitation);
      monitorState.reading = fieldFrame.signals.excitation.toFixed(2);
      return;
    case "change":
      monitorState.graph = clamp01(fieldFrame.signals.change);
      monitorState.reading = fieldFrame.signals.change.toFixed(2);
      return;
    case "pulse":
      monitorState.graph = clamp01(fieldFrame.signals.pulse);
      monitorState.reading = fieldFrame.signals.pulse.toFixed(2);
      return;
    case "low":
      monitorState.graph = clamp01(fieldFrame.bands.low);
      monitorState.reading = fieldFrame.bands.low.toFixed(2);
      return;
    case "mid":
      monitorState.graph = clamp01(fieldFrame.bands.mid);
      monitorState.reading = fieldFrame.bands.mid.toFixed(2);
      return;
    case "high":
      monitorState.graph = clamp01(fieldFrame.bands.high);
      monitorState.reading = fieldFrame.bands.high.toFixed(2);
      return;
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
