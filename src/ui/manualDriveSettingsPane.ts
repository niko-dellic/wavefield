import { Pane } from "tweakpane";

import { AUDIO_CONTROLS } from "../config/settings";
import type { CymaticSettings } from "../types";
import { applyTooltipsByLabel } from "./controls";

export class ManualDriveSettingsPane {
  private pane: Pane | null = null;
  private layoutKey = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange: () => void,
  ) {}

  refresh() {
    this.pane?.refresh();
  }

  sync(settings: CymaticSettings) {
    if (settings.driveMode !== "manual") {
      this.host.hidden = true;
      this.dispose();
      return;
    }

    this.host.hidden = false;
    const nextLayoutKey = `manual:${settings.frequencySweep}`;
    if (this.pane && nextLayoutKey === this.layoutKey) {
      this.pane.refresh();
      return;
    }

    this.dispose();
    this.layoutKey = nextLayoutKey;
    this.pane = new Pane({
      container: this.host,
    });
    this.pane.addBinding(settings, "testFrequency", {
      label: AUDIO_CONTROLS.testFrequency.label,
      min: AUDIO_CONTROLS.testFrequency.min,
      max: AUDIO_CONTROLS.testFrequency.max,
      step: AUDIO_CONTROLS.testFrequency.step,
    });
    this.pane.addBinding(settings, "frequencySweep", {
      label: "sweep",
    });
    if (settings.frequencySweep) {
      this.pane.addBinding(settings, "frequencySweepRate", {
        label: AUDIO_CONTROLS.frequencySweepRate.label,
        min: AUDIO_CONTROLS.frequencySweepRate.min,
        max: AUDIO_CONTROLS.frequencySweepRate.max,
        step: AUDIO_CONTROLS.frequencySweepRate.step,
      });
      this.pane.addBinding(settings, "frequencySweepRange", {
        label: AUDIO_CONTROLS.frequencySweepRange.label,
        min: AUDIO_CONTROLS.frequencySweepRange.min,
        max: AUDIO_CONTROLS.frequencySweepRange.max,
        step: AUDIO_CONTROLS.frequencySweepRange.step,
      });
    }
    this.pane.on("change", this.onChange);
    applyTooltipsByLabel(this.host);
  }

  dispose() {
    this.pane?.dispose();
    this.pane = null;
    this.layoutKey = "";
  }
}
