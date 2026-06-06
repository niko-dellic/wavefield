import * as THREE from "three";
import { Pane } from "tweakpane";

import {
  EMPTY_MODAL_FIELD_FRAME,
  ModalFieldEngine,
  createAmbientModalFieldFrame,
  type ModalFieldFrame,
} from "./audio/ModalField";
import { getFirstMeaningfulFrameTime } from "./audio/analysisPreview";
import { AudioController } from "./audio/audioController";
import { LiveAudioAnalyzer } from "./audio/liveAnalysis";
import {
  BOUNDARY_TRANSITION_STORAGE_KEY,
  DEFAULT_BOUNDARY_TRANSITION_CONFIG,
  coerceBoundaryTransitionConfig,
  type BoundaryTransitionConfig,
} from "./boundaryTransition";
import { AUDIO_CONTROLS, DEFAULT_SETTINGS } from "./config/settings";
import type { KeyCommandId } from "./keybindings";
import { saveJsonToLocalStorage } from "./storage";
import {
  cloneCymaticSettings,
  createSettingsFromTemplate,
  loadWavefieldTemplates,
  type WavefieldTemplate,
} from "./templateSettings";
import {
  DEFAULT_TEMPLATE_TRANSITION_CONFIG,
  TEMPLATE_TRANSITION_STORAGE_KEY,
  advanceTemplateTransition,
  coerceTemplateTransitionConfig,
  createEffectiveCymaticSettings,
  createTemplateTransition,
  type TemplateTransitionConfig,
  type TemplateTransitionState,
} from "./templateTransition";
import {
  TemplateController,
  loadTemplateKeyBindings,
} from "./templates/templateController";
import { OverlayController } from "./ui/overlayController";
import {
  applyTooltipsByLabel,
  createControls,
  type ControlsManager,
  type MonitorState,
} from "./ui/controls";
import {
  BOUNDARY_OPTIONS,
  formatBoundaryMode,
  formatDriveMode,
  formatFixtureLabel,
} from "./ui/format";
import { ScreenViewController } from "./ui/screenViewController";
import { renderWavefieldShell, type ShellFixture } from "./ui/shell";
import {
  queryShellElements,
  type ShellElements,
} from "./ui/shellElements";
import {
  ModalFieldRenderer,
  type ScreenViewTransform,
} from "./webgl/ModalFieldRenderer";
import type {
  AudioAnalysis,
  BoundaryMode,
  CymaticSettings,
  DriveMode,
  EffectiveCymaticSettings,
} from "./types";

const FIXTURES = Object.entries(
  import.meta.glob<string>("./fixtures/audio/*.mp3", {
    eager: true,
    import: "default",
  }),
).map(([path, url]) => ({
  label: formatFixtureLabel(path),
  url,
})) satisfies ShellFixture[];
const TEMPLATE_MODULES = import.meta.glob<unknown>("./templates/*.json", {
  eager: true,
  import: "default",
});
const INITIAL_TEMPLATES = loadWavefieldTemplates(TEMPLATE_MODULES);

export class WavefieldApp {
  private readonly settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  private effectiveSettings: EffectiveCymaticSettings =
    createEffectiveCymaticSettings(this.settings);
  private templateTransition: TemplateTransitionState | null = null;
  private boundaryTransitionConfig: BoundaryTransitionConfig =
    loadBoundaryTransitionConfig();
  private boundaryTransition: TemplateTransitionState | null = null;
  private readonly modalEngine = new ModalFieldEngine();
  private readonly liveAnalyzer = new LiveAudioAnalyzer();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly modalRenderer = new ModalFieldRenderer();
  private readonly ui: ShellElements;
  private readonly controls: ControlsManager;
  private readonly audio: AudioController;
  private readonly overlayController: OverlayController;
  private readonly screenView: ScreenViewController;
  private readonly templates: TemplateController;
  private readonly disposers: Array<() => void> = [];
  private modeSettingsPane: Pane | null = null;
  private modeSettingsLayoutKey = "";
  private analysis: AudioAnalysis | null = null;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private ambientSeconds = 0;
  private manualSeconds = 0;
  private liveSeconds = 0;
  private analysisPreviewTime = 0;
  private fieldSettingsKey = "";
  private readonly monitorState: MonitorState = {
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
  private lastModalFieldFrame: ModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = renderWavefieldShell(
      FIXTURES,
      this.settings.boundaryMode,
    );
    this.ui = queryShellElements(this.root);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.ui.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(DEFAULT_SETTINGS.backgroundColor, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.syncBackgroundColor();

    this.templates = new TemplateController({
      templates: INITIAL_TEMPLATES,
      transitionConfig: loadTemplateTransitionConfig(),
      keyBindings: loadTemplateKeyBindings(INITIAL_TEMPLATES),
      onApplyTemplate: (template) => this.startTemplateTransition(template),
      onTransitionConfigChange: () => undefined,
      onStatus: (message) => this.setStatus(message),
      getCurrentSettings: () => this.effectiveSettings,
      refreshControls: () => this.controls?.refresh(),
    });

    this.audio = new AudioController({
      root: this.root,
      ui: this.ui,
      fixtures: FIXTURES,
      canTogglePlayback: () => this.settings.driveMode === "audio",
      onAnalysis: (analysis) => this.setAnalysis(analysis),
      onInteractionReset: (time) => this.modalEngine.reset(time),
      onPrepareForNewAudio: () => this.prepareForNewAudio(),
      onSeekReset: (time) => {
        this.modalEngine.reset(time);
        this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
        this.resetVisualState();
      },
      onStatus: (message) => this.setStatus(message),
    });

    this.controls = createControls(
      this.ui.guiHost,
      this.settings,
      () => this.handleSettingsChange(),
      this.monitorState,
      () => this.templates.getControlsOptions(),
      {
        config: {
          ...this.boundaryTransitionConfig,
          applyBoundaryMode: true,
        },
        onChange: (config) => this.setBoundaryTransitionConfig(config),
      },
    );

    this.overlayController = new OverlayController({
      root: this.root,
      ui: this.ui,
      controls: this.controls,
      onStatus: (message) => this.setStatus(message),
    });
    this.screenView = new ScreenViewController(this.ui.canvas, () => ({
      projectionMode: this.settings.projectionMode,
      screenAspectMode: this.settings.screenAspectMode,
    }));

    this.bindUi();
    this.audio.bind();
    this.overlayController.bind();
    this.screenView.bind();
    this.syncHeaderControls();
    this.fieldSettingsKey = getFieldSettingsKey(this.settings);
    this.resize();
  }

  start() {
    this.animationFrame = requestAnimationFrame(this.animate);
    void this.audio.loadDefaultFixture();
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.overlayController.dispose();
    this.screenView.dispose();
    this.controls.dispose();
    this.disposeModeSettingsPane();
    this.audio.dispose();
    this.liveAnalyzer.stop();
    this.modalRenderer.dispose();
    this.renderer.dispose();
  }

  private bindUi() {
    this.addWindowListener("resize", this.resize);
    this.addDocumentListener("keydown", this.handleKeyDown, true);

    this.addEventListener(this.ui.driveModeSelect, "change", () => {
      void this.setDriveMode(this.ui.driveModeSelect.value as DriveMode);
    });
    for (const input of this.ui.boundaryInputs) {
      this.addEventListener(input, "change", () => {
        if (input.checked) {
          this.setBoundaryMode(input.value as BoundaryMode);
        }
      });
    }
    this.addEventListener(this.ui.drivePane, "toggle", () => {
      this.modeSettingsPane?.refresh();
    });
    this.addEventListener(this.ui.canvas, "click", () => {
      if (this.ui.drivePane.open) {
        this.ui.drivePane.open = false;
      }
    });
  }

  private setAnalysis(analysis: AudioAnalysis) {
    this.analysis = analysis;
    this.analysisPreviewTime = getFirstMeaningfulFrameTime(analysis);
    this.modalEngine.setAnalysis(analysis);
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.manualSeconds = 0;
    this.resetVisualState();
  }

  private prepareForNewAudio() {
    this.analysis = null;
    this.analysisPreviewTime = 0;
    this.modalEngine.setAnalysis(null);
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.ambientSeconds = 0;
    this.manualSeconds = 0;
    this.liveSeconds = 0;
    this.audio.setPlayButton(false);
    this.resetVisualState();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.templates.capturingKeybindSlug) {
      this.templates.handleTemplateKeyCapture(event);
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.repeat) {
      return;
    }

    if (this.overlayController.isAboutOpen && event.code === "Escape") {
      event.preventDefault();
      this.overlayController.setAboutOpen(false);
      return;
    }

    if (this.overlayController.isSettingsOpen && event.code === "Escape") {
      event.preventDefault();
      this.overlayController.setSettingsOpen(false);
      return;
    }

    const command = this.templates.getCommandForKeyboardEvent(event);
    if (!command) {
      return;
    }

    if (isTextEntryKeyboardTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.runKeyCommand(command.id);
  };

  private readonly animate = (now: number) => {
    const deltaSeconds = Math.min(0.1, (now - this.lastFrameTime) / 1_000);
    this.lastFrameTime = now;
    const renderSettings = this.updateTemplateTransition(deltaSeconds);
    const time = this.audio.getCurrentTime();
    const isPlaying = this.audio.isPlaying();
    const isManualDrive = renderSettings.driveMode === "manual";
    const isLiveDrive = renderSettings.driveMode === "live";
    let fieldFrame = this.lastModalFieldFrame;
    let renderDeltaSeconds = 0;
    let isIdlePreview = false;

    if (isManualDrive) {
      this.manualSeconds += deltaSeconds;
      fieldFrame = this.modalEngine.update(
        this.manualSeconds,
        renderSettings,
        deltaSeconds || 1 / 60,
      );
      this.lastModalFieldFrame = fieldFrame;
      renderDeltaSeconds = deltaSeconds;
    } else if (isLiveDrive) {
      this.liveSeconds += deltaSeconds;
      const liveFrame = this.liveAnalyzer.getFrame(this.liveSeconds);
      if (liveFrame) {
        fieldFrame = this.modalEngine.updateFromFeatureFrame(
          liveFrame,
          renderSettings,
          deltaSeconds || 1 / 60,
        );
        this.lastModalFieldFrame = fieldFrame;
        renderDeltaSeconds = deltaSeconds;
      } else {
        this.ambientSeconds += deltaSeconds;
        fieldFrame = createAmbientModalFieldFrame(this.ambientSeconds);
        renderDeltaSeconds = deltaSeconds;
        isIdlePreview = true;
      }
    } else if (!this.analysis) {
      this.ambientSeconds += deltaSeconds;
      fieldFrame = createAmbientModalFieldFrame(this.ambientSeconds);
      renderDeltaSeconds = deltaSeconds;
      isIdlePreview = true;
    } else if (isPlaying) {
      fieldFrame = this.modalEngine.update(time, renderSettings, deltaSeconds);
      this.lastModalFieldFrame = fieldFrame;
      renderDeltaSeconds = deltaSeconds;
    } else if (fieldFrame.modes.length === 0) {
      const previewTime = time > 0.05 ? time : this.analysisPreviewTime;
      fieldFrame = this.modalEngine.update(
        previewTime,
        renderSettings,
        1 / 60,
      );
      this.lastModalFieldFrame = fieldFrame;
    }

    this.screenView.update(deltaSeconds);
    if (this.overlayController.isSettingsOpen) {
      this.updateMonitorState(fieldFrame);
    }
    this.modalRenderer.render(
      this.renderer,
      fieldFrame,
      renderSettings,
      this.screenView.view as ScreenViewTransform,
      renderDeltaSeconds,
      isIdlePreview,
    );

    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private updateMonitorState(fieldFrame: ModalFieldFrame) {
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

    const peak = fieldFrame.peaks[0];
    this.monitorState.drive = formatDriveMode(this.settings.driveMode);
    this.monitorState.peak = peak
      ? `${Math.round(peak.frequency)} Hz`
      : fieldFrame.debug.peakSummary;
    this.monitorState.base =
      fieldFrame.debug.topologyFrequency > 0
        ? `${Math.round(fieldFrame.debug.topologyFrequency)} Hz / ${fieldFrame.debug.topologyMode}`
        : "none";
    this.monitorState.modes = `${fieldFrame.modes.length}/${fieldFrame.debug.activeModeCount}`;
    this.monitorState.topology = fieldFrame.signals.topology;
    this.monitorState.excitation = fieldFrame.debug.excitation;
    this.monitorState.change = fieldFrame.signals.change;
    this.monitorState.pulse = fieldFrame.signals.pulse;

    switch (this.settings.monitorSignal) {
      case "frequency": {
        const frequency =
          fieldFrame.debug.topologyFrequency ||
          fieldFrame.peaks[0]?.frequency ||
          0;
        this.monitorState.graph =
          frequency > 0
            ? clamp01(
                (Math.log2(frequency) - Math.log2(70)) /
                  (Math.log2(7_200) - Math.log2(70)),
              )
            : 0;
        this.monitorState.reading = `${Math.round(frequency)} Hz`;
        return;
      }
      case "level":
        this.monitorState.graph = clamp01(fieldFrame.rms);
        this.monitorState.reading = fieldFrame.rms.toFixed(2);
        return;
      case "excitation":
        this.monitorState.graph = clamp01(fieldFrame.signals.excitation);
        this.monitorState.reading = fieldFrame.signals.excitation.toFixed(2);
        return;
      case "change":
        this.monitorState.graph = clamp01(fieldFrame.signals.change);
        this.monitorState.reading = fieldFrame.signals.change.toFixed(2);
        return;
      case "pulse":
        this.monitorState.graph = clamp01(fieldFrame.signals.pulse);
        this.monitorState.reading = fieldFrame.signals.pulse.toFixed(2);
        return;
      case "low":
        this.monitorState.graph = clamp01(fieldFrame.bands.low);
        this.monitorState.reading = fieldFrame.bands.low.toFixed(2);
        return;
      case "mid":
        this.monitorState.graph = clamp01(fieldFrame.bands.mid);
        this.monitorState.reading = fieldFrame.bands.mid.toFixed(2);
        return;
      case "high":
        this.monitorState.graph = clamp01(fieldFrame.bands.high);
        this.monitorState.reading = fieldFrame.bands.high.toFixed(2);
        return;
    }
  }

  private readonly resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.modalRenderer.setSize(this.ui.canvas.width, this.ui.canvas.height);
    this.overlayController.syncSettingsMode();
  };

  private setStatus(_message: string) {
    // Status messages are intentionally non-visual; the diagnostics strip is reserved for controls.
  }

  private startTemplateTransition(template: WavefieldTemplate) {
    const nextSettings = createSettingsFromTemplate(
      template.settings,
      this.settings,
    );
    const shouldApplyBoundaryMode =
      this.templates.transitionConfig.applyBoundaryMode;
    this.boundaryTransition = null;
    this.templateTransition = createTemplateTransition(
      this.effectiveSettings,
      nextSettings,
      this.templates.transitionConfig,
    );
    if (shouldApplyBoundaryMode) {
      this.settings.boundaryMode = nextSettings.boundaryMode;
      this.syncHeaderControls();
    } else {
      this.controls.refresh();
    }
  }

  private updateTemplateTransition(deltaSeconds: number) {
    if (!this.templateTransition && !this.boundaryTransition) {
      return this.effectiveSettings;
    }

    if (this.templateTransition) {
      const result = advanceTemplateTransition(
        this.templateTransition,
        deltaSeconds,
      );
      this.templateTransition = result.done ? null : result.transition;
      this.effectiveSettings = result.settings;
      this.syncBackgroundColor(this.effectiveSettings);

      if (result.done) {
        this.commitEffectiveSettings(result.settings);
      }

      return this.effectiveSettings;
    }

    const boundaryTransition = this.boundaryTransition;
    if (!boundaryTransition) {
      return this.effectiveSettings;
    }

    const result = advanceTemplateTransition(boundaryTransition, deltaSeconds);
    this.boundaryTransition = result.done ? null : result.transition;
    this.effectiveSettings = result.settings;
    this.syncBackgroundColor(this.effectiveSettings);

    if (result.done) {
      this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
    }

    return this.effectiveSettings;
  }

  private commitEffectiveSettings(settings: EffectiveCymaticSettings) {
    const currentDriveMode = this.settings.driveMode;
    Object.assign(this.settings, cloneCymaticSettings(settings));
    this.settings.driveMode = currentDriveMode;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
    this.handleSettingsChange();
  }

  private runKeyCommand(commandId: KeyCommandId) {
    if (commandId === "ui.settings") {
      if (document.fullscreenElement === this.root) {
        this.overlayController.setFullscreenUiVisible(
          !this.overlayController.isFullscreenUiVisible,
        );
        return;
      }

      this.overlayController.setSettingsOpen(
        !this.overlayController.isSettingsOpen,
        this.ui.settingsButton,
      );
      return;
    }

    if (commandId === "ui.fullscreen") {
      void this.overlayController.toggleFullscreen();
      return;
    }

    if (commandId === "audio.playback") {
      if (this.settings.driveMode === "audio") {
        void this.audio.togglePlayback();
      }
      return;
    }

    if (commandId === "boundary.freePlate") {
      this.setBoundaryMode("freePlate");
      return;
    }

    if (commandId === "boundary.dirichlet") {
      this.setBoundaryMode("dirichlet");
      return;
    }

    if (commandId === "boundary.neumann") {
      this.setBoundaryMode("neumann");
      return;
    }

    if (commandId === "boundary.clamped") {
      this.setBoundaryMode("clamped");
      return;
    }

    if (commandId === "boundary.supported") {
      this.setBoundaryMode("supported");
      return;
    }

    if (commandId === "template.previous") {
      this.templates.cycleTemplate(-1);
      return;
    }

    if (commandId === "template.next") {
      this.templates.cycleTemplate(1);
      return;
    }

    this.templates.runApplyCommand(commandId);
  }

  private handleSettingsChange() {
    this.templateTransition = null;
    this.boundaryTransition = null;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
    if (this.settings.projectionMode !== "screen") {
      this.screenView.endPan();
    }

    const nextFieldSettingsKey = getFieldSettingsKey(this.settings);
    if (nextFieldSettingsKey !== this.fieldSettingsKey) {
      this.fieldSettingsKey = nextFieldSettingsKey;
      if (this.settings.driveMode === "manual") {
        this.manualSeconds = 0;
        this.modalEngine.reset(0);
      } else if (this.settings.driveMode === "live") {
        this.modalEngine.reset(this.liveSeconds);
      } else {
        this.modalEngine.reset(this.audio.getCurrentTime());
      }
      this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
      this.resetVisualState();
    }
    this.syncBackgroundColor();
    this.setStatus("Settings updated");
    this.syncHeaderControls();
  }

  private syncBackgroundColor(settings: CymaticSettings = this.settings) {
    const backgroundColor = normalizeHexColor(settings.backgroundColor);
    this.root.style.setProperty("--wavefield-background", backgroundColor);
    document.documentElement.style.setProperty(
      "--wavefield-background",
      backgroundColor,
    );
  }

  private syncHeaderControls() {
    this.ui.driveModeSelect.value = this.settings.driveMode;
    this.ui.boundaryInputs.forEach((input) => {
      input.checked = input.value === this.settings.boundaryMode;
    });
    this.ui.driveSummaryValue.textContent = formatDriveMode(
      this.settings.driveMode,
    );
    this.ui.sourcePicker.hidden = this.settings.driveMode !== "audio";
    this.ui.transport.hidden = this.settings.driveMode !== "audio";
    this.root.classList.toggle(
      "is-audio-drive",
      this.settings.driveMode === "audio",
    );
    this.root.classList.toggle(
      "is-live-recording",
      this.settings.driveMode === "live" && this.liveAnalyzer.isActive,
    );
    this.syncModeSettingsPane();
    this.controls.refresh();
  }

  private resetVisualState() {
    this.modalRenderer.requestReset();
  }

  private setBoundaryMode(boundaryMode: BoundaryMode) {
    const hasActiveTransition =
      this.templateTransition !== null || this.boundaryTransition !== null;
    if (this.settings.boundaryMode === boundaryMode && !hasActiveTransition) {
      this.syncHeaderControls();
      return;
    }

    const sourceSettings = this.effectiveSettings;
    const shouldMorph = this.boundaryTransitionConfig.enabled;
    this.templates.clearActiveTemplate();
    this.settings.boundaryMode = boundaryMode;
    if (shouldMorph) {
      this.templateTransition = null;
      this.boundaryTransition = createTemplateTransition(
        sourceSettings,
        this.settings,
        this.boundaryTransitionConfig,
      );
      this.effectiveSettings = sourceSettings;
      this.fieldSettingsKey = getFieldSettingsKey(this.settings);
      this.syncBackgroundColor(this.effectiveSettings);
      this.syncHeaderControls();
    } else {
      this.handleSettingsChange();
    }
    this.setStatus(`Resonance: ${formatBoundaryMode(boundaryMode)}`);
  }

  private async setDriveMode(driveMode: DriveMode, announce = true) {
    const shouldRestartLive =
      driveMode === "live" &&
      (this.settings.driveMode !== "live" || !this.liveAnalyzer.isActive);

    if (this.settings.driveMode === driveMode && !shouldRestartLive) {
      this.syncHeaderControls();
      return;
    }

    this.settings.driveMode = driveMode;
    if (driveMode !== "audio") {
      this.audio.pause();
    }
    if (driveMode !== "live") {
      this.liveAnalyzer.stop();
    }

    this.ambientSeconds = 0;
    this.manualSeconds = 0;
    this.liveSeconds = 0;
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.modalEngine.reset(
      driveMode === "audio" ? this.audio.getCurrentTime() : 0,
    );
    this.fieldSettingsKey = getFieldSettingsKey(this.settings);
    this.resetVisualState();
    this.syncHeaderControls();

    if (driveMode === "live") {
      try {
        await this.liveAnalyzer.start();
      } catch (error) {
        this.liveAnalyzer.stop();
        this.setStatus(
          error instanceof Error
            ? error.message
            : "Microphone input could not be started",
        );
      }
      this.syncHeaderControls();
      if (announce) {
        this.setStatus(`Drive: ${formatDriveMode(driveMode)}`);
      }
      return;
    }

    if (announce) {
      this.setStatus(`Drive: ${formatDriveMode(driveMode)}`);
    }
  }

  private syncModeSettingsPane() {
    if (this.settings.driveMode !== "manual") {
      this.ui.modeSettingsHost.hidden = true;
      this.disposeModeSettingsPane();
      return;
    }

    this.ui.modeSettingsHost.hidden = false;
    const nextLayoutKey = `manual:${this.settings.frequencySweep}`;
    if (this.modeSettingsPane && nextLayoutKey === this.modeSettingsLayoutKey) {
      this.modeSettingsPane.refresh();
      return;
    }

    this.disposeModeSettingsPane();
    this.modeSettingsLayoutKey = nextLayoutKey;
    this.modeSettingsPane = new Pane({
      container: this.ui.modeSettingsHost,
    });
    this.modeSettingsPane.addBinding(this.settings, "testFrequency", {
      label: AUDIO_CONTROLS.testFrequency.label,
      min: AUDIO_CONTROLS.testFrequency.min,
      max: AUDIO_CONTROLS.testFrequency.max,
      step: AUDIO_CONTROLS.testFrequency.step,
    });
    this.modeSettingsPane.addBinding(this.settings, "frequencySweep", {
      label: "sweep",
    });
    if (this.settings.frequencySweep) {
      this.modeSettingsPane.addBinding(this.settings, "frequencySweepRate", {
        label: AUDIO_CONTROLS.frequencySweepRate.label,
        min: AUDIO_CONTROLS.frequencySweepRate.min,
        max: AUDIO_CONTROLS.frequencySweepRate.max,
        step: AUDIO_CONTROLS.frequencySweepRate.step,
      });
      this.modeSettingsPane.addBinding(this.settings, "frequencySweepRange", {
        label: AUDIO_CONTROLS.frequencySweepRange.label,
        min: AUDIO_CONTROLS.frequencySweepRange.min,
        max: AUDIO_CONTROLS.frequencySweepRange.max,
        step: AUDIO_CONTROLS.frequencySweepRange.step,
      });
    }
    this.modeSettingsPane.on("change", () => {
      this.handleSettingsChange();
    });
    applyTooltipsByLabel(this.ui.modeSettingsHost);
  }

  private disposeModeSettingsPane() {
    this.modeSettingsPane?.dispose();
    this.modeSettingsPane = null;
    this.modeSettingsLayoutKey = "";
  }

  private setBoundaryTransitionConfig(config: BoundaryTransitionConfig) {
    Object.assign(
      this.boundaryTransitionConfig,
      coerceBoundaryTransitionConfig(config),
    );
    saveJsonToLocalStorage(
      BOUNDARY_TRANSITION_STORAGE_KEY,
      this.boundaryTransitionConfig,
    );
    this.syncHeaderControls();
  }

  private addEventListener<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) {
    target.addEventListener(type, listener);
    this.disposers.push(() => {
      target.removeEventListener(type, listener);
    });
  }

  private addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
  ) {
    window.addEventListener(type, listener);
    this.disposers.push(() => {
      window.removeEventListener(type, listener);
    });
  }

  private addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ) {
    document.addEventListener(type, listener, options);
    this.disposers.push(() => {
      document.removeEventListener(type, listener, options);
    });
  }
}

function getFieldSettingsKey(settings: CymaticSettings) {
  return [settings.driveMode, settings.boundaryMode].join(":");
}

function isTextEntryKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  const editable = target.closest<HTMLElement>(
    "textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
  );
  if (editable) {
    return true;
  }

  const input = target.closest<HTMLInputElement>("input");
  if (!input) {
    return false;
  }

  return !["button", "checkbox", "radio", "reset", "submit"].includes(
    input.type,
  );
}

function normalizeHexColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : DEFAULT_SETTINGS.backgroundColor;
}

function loadTemplateTransitionConfig() {
  try {
    const rawValue = window.localStorage.getItem(
      TEMPLATE_TRANSITION_STORAGE_KEY,
    );
    const config = coerceTemplateTransitionConfig(
      rawValue ? JSON.parse(rawValue) : DEFAULT_TEMPLATE_TRANSITION_CONFIG,
    );
    config.applyBoundaryMode = true;
    saveJsonToLocalStorage(TEMPLATE_TRANSITION_STORAGE_KEY, config);
    return config;
  } catch {
    return { ...DEFAULT_TEMPLATE_TRANSITION_CONFIG };
  }
}

function loadBoundaryTransitionConfig() {
  try {
    const rawValue = window.localStorage.getItem(
      BOUNDARY_TRANSITION_STORAGE_KEY,
    );
    return coerceBoundaryTransitionConfig(
      rawValue ? JSON.parse(rawValue) : DEFAULT_BOUNDARY_TRANSITION_CONFIG,
    );
  } catch {
    return { ...DEFAULT_BOUNDARY_TRANSITION_CONFIG };
  }
}
