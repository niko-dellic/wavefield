import * as THREE from "three";
import {
  EMPTY_MODAL_FIELD_FRAME,
  ModalFieldEngine,
  createAmbientModalFieldFrame,
  type ModalFieldFrame,
} from "./audio/ModalField";
import { getFirstMeaningfulFrameTime } from "./audio/analysisPreview";
import { AudioController } from "./audio/audioController";
import { LiveAudioAnalyzer } from "./audio/liveAnalysis";
import { DEFAULT_SETTINGS } from "./config/settings";
import { loadWavefieldTemplates } from "./templateSettings";
import {
  TemplateController,
  loadTemplateKeyBindings,
} from "./templates/templateController";
import {
  SettingsTransitionController,
  loadTemplateTransitionConfig,
} from "./templates/settingsTransitionController";
import { OverlayController } from "./ui/overlayController";
import {
  createControls,
  type ControlsManager,
  type MonitorState,
} from "./ui/controls";
import {
  formatBoundaryMode,
  formatDriveMode,
  formatFixtureLabel,
} from "./ui/format";
import { KeyCommandRouter } from "./ui/keyCommandRouter";
import { ManualDriveSettingsPane } from "./ui/manualDriveSettingsPane";
import {
  createInitialMonitorState,
  updateMonitorState,
} from "./ui/monitorState";
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
  FieldModel,
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
  private readonly settingsTransitions = new SettingsTransitionController(
    this.settings,
  );
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
  private readonly manualDriveSettingsPane: ManualDriveSettingsPane;
  private readonly keyCommandRouter: KeyCommandRouter;
  private readonly disposers: Array<() => void> = [];
  private analysis: AudioAnalysis | null = null;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private ambientSeconds = 0;
  private manualSeconds = 0;
  private liveSeconds = 0;
  private analysisPreviewTime = 0;
  private fieldSettingsKey = "";
  private readonly monitorState: MonitorState = createInitialMonitorState();
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
      onApplyTemplate: (template) => {
        const result = this.settingsTransitions.startTemplateTransition(
          template,
          this.templates.transitionConfig,
        );
        if (result.appliedBoundaryMode) {
          this.syncHeaderControls();
        } else {
          this.controls.refresh();
        }
      },
      onTransitionConfigChange: () => undefined,
      onStatus: (message) => this.setStatus(message),
      getCurrentSettings: () => this.settingsTransitions.effectiveSettings,
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
        config: this.settingsTransitions.boundaryControlsConfig,
        onChange: (config) => {
          this.settingsTransitions.setBoundaryTransitionConfig(config);
          this.syncHeaderControls();
        },
      },
      (boundaryMode) => this.setBoundaryMode(boundaryMode),
      (fieldModel) => this.setFieldModel(fieldModel),
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
    this.manualDriveSettingsPane = new ManualDriveSettingsPane(
      this.ui.modeSettingsHost,
      () => this.handleSettingsChange(),
    );
    this.keyCommandRouter = new KeyCommandRouter({
      root: this.root,
      settings: this.settings,
      ui: this.ui,
      audio: this.audio,
      overlayController: this.overlayController,
      templates: this.templates,
      onBoundaryMode: (boundaryMode) => this.setBoundaryMode(boundaryMode),
    });

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
    this.manualDriveSettingsPane.dispose();
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
      this.manualDriveSettingsPane.refresh();
    });
    this.addEventListener(this.ui.canvas, "pointerdown", () => {
      this.overlayController.collapseDrivePane();
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
    this.keyCommandRouter.run(command.id);
  };

  private readonly animate = (now: number) => {
    const deltaSeconds = Math.min(0.1, (now - this.lastFrameTime) / 1_000);
    this.lastFrameTime = now;
    const transitionResult = this.settingsTransitions.advance(deltaSeconds);
    const renderSettings = transitionResult.settings;
    this.syncBackgroundColor(renderSettings);
    if (transitionResult.didCommitTemplate) {
      this.handleSettingsChange();
    }
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
      updateMonitorState(this.monitorState, this.settings, fieldFrame);
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

  private handleSettingsChange() {
    this.settingsTransitions.resetToCurrentSettings();
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
    this.manualDriveSettingsPane.sync(this.settings);
    this.controls.refresh();
  }

  private resetVisualState() {
    this.modalRenderer.requestReset();
  }

  private setBoundaryMode(boundaryMode: BoundaryMode) {
    const result = this.settingsTransitions.setBoundaryMode(boundaryMode);
    if (!result.changed) {
      this.syncHeaderControls();
      return;
    }

    this.templates.clearActiveTemplate();
    if (result.morphed) {
      this.fieldSettingsKey = getFieldSettingsKey(this.settings);
      this.syncBackgroundColor(this.settingsTransitions.effectiveSettings);
      this.syncHeaderControls();
    } else {
      this.handleSettingsChange();
    }
    this.setStatus(`Resonance: ${formatBoundaryMode(boundaryMode)}`);
  }

  private setFieldModel(fieldModel: FieldModel) {
    const result = this.settingsTransitions.setFieldModel(fieldModel);
    if (!result.changed) {
      this.controls.refresh();
      return;
    }

    this.templates.clearActiveTemplate();
    if (result.morphed) {
      this.syncBackgroundColor(this.settingsTransitions.effectiveSettings);
      this.controls.refresh();
    } else {
      this.handleSettingsChange();
    }
    this.setStatus(`Model: ${fieldModel}`);
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
    this.settingsTransitions.syncRuntimeSettings();
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
  return [settings.driveMode, settings.boundaryMode, settings.fieldModel].join(":");
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
