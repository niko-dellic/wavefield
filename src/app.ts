import * as THREE from "three";
import { Pane } from "tweakpane";
import WaveSurfer from "wavesurfer.js";

import {
  EMPTY_MODAL_FIELD_FRAME,
  ModalFieldEngine,
  createAmbientModalFieldFrame,
  type ModalFieldFrame,
} from "./audio/ModalField";
import { decodeAndAnalyzeAudio } from "./audio/analyze";
import { LiveAudioAnalyzer } from "./audio/liveAnalysis";
import { AUDIO_CONTROLS, DEFAULT_SETTINGS } from "./config/settings";
import {
  applyTooltipsByLabel,
  createControls,
  type ControlsManager,
  type MonitorState,
} from "./ui/controls";
import {
  cloneTemplateSettings,
  coerceCymaticSettings,
  coerceWavefieldTemplate,
  loadWavefieldTemplates,
  sortWavefieldTemplates,
  type WavefieldTemplate,
} from "./templateSettings";
import {
  ModalFieldRenderer,
  type ScreenViewTransform,
} from "./webgl/ModalFieldRenderer";
import type {
  AudioAnalysis,
  BoundaryMode,
  CymaticSettings,
  DriveMode,
} from "./types";

const SCREEN_VIEW_MIN_SCALE = 0.05;
const SCREEN_VIEW_MAX_SCALE = 16;
const SCREEN_WHEEL_ZOOM_SPEED = 0.0015;
const SCREEN_PINCH_MIN_DISTANCE = 8;
const SCREEN_PAN_DAMPING = 10;
const SCREEN_ZOOM_DAMPING = 14;
const MOBILE_SETTINGS_MEDIA = "(max-width: 560px)";

const FIXTURES = Object.entries(
  import.meta.glob<string>("./fixtures/audio/*.mp3", {
    eager: true,
    import: "default",
  }),
).map(([path, url]) => ({
  label: formatFixtureLabel(path),
  url,
}));
const DEFAULT_FIXTURE = FIXTURES[0];
const TEMPLATE_MODULES = import.meta.glob<unknown>("./templates/*.json", {
  eager: true,
  import: "default",
});
const INITIAL_TEMPLATES = loadWavefieldTemplates(TEMPLATE_MODULES);
const BOUNDARY_OPTIONS = [
  { label: "Free", value: "freePlate" },
  { label: "Dir", value: "dirichlet" },
  { label: "Neu", value: "neumann" },
] satisfies Array<{ label: string; value: BoundaryMode }>;

export class WavefieldApp {
  private readonly settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  private readonly templates: WavefieldTemplate[] = [...INITIAL_TEMPLATES];
  private readonly templateSaveState = { name: "" };
  private readonly modalEngine = new ModalFieldEngine();
  private readonly liveAnalyzer = new LiveAudioAnalyzer();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly modalRenderer = new ModalFieldRenderer();
  private readonly wavesurfer: WaveSurfer;
  private readonly controls: ControlsManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly playButton: HTMLButtonElement;
  private readonly volumeButton: HTMLButtonElement;
  private readonly volumeSlider: HTMLInputElement;
  private readonly sourceTrigger: HTMLButtonElement;
  private readonly sourceMenu: HTMLElement;
  private readonly sourcePicker: HTMLElement;
  private readonly selectedSource: HTMLElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly boundaryInputs: HTMLInputElement[];
  private readonly settingsModal: HTMLElement;
  private readonly settingsPanel: HTMLElement;
  private readonly settingsCloseButton: HTMLButtonElement;
  private readonly desktopDriveHost: HTMLElement;
  private readonly mobileDriveHost: HTMLElement;
  private readonly drivePane: HTMLDetailsElement;
  private readonly driveSummaryValue: HTMLElement;
  private readonly driveModeSelect: HTMLSelectElement;
  private readonly modeSettingsHost: HTMLElement;
  private readonly transport: HTMLElement;
  private readonly guiHost: HTMLElement;
  private readonly mobileSettingsMedia = window.matchMedia(MOBILE_SETTINGS_MEDIA);
  private modeSettingsPane: Pane | null = null;
  private modeSettingsLayoutKey = "";
  private isSettingsOpen = false;
  private isMobileSettings = false;
  private lastSettingsTrigger: HTMLElement | null = null;
  private analysis: AudioAnalysis | null = null;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private ambientSeconds = 0;
  private manualSeconds = 0;
  private liveSeconds = 0;
  private analysisPreviewTime = 0;
  private fieldSettingsKey = "";
  private lastAudibleVolume = 1;
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
  private readonly screenView: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  private readonly screenViewTarget: ScreenViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  private readonly screenTouchPointers = new Map<number, ScreenPointer>();
  private screenPanPointerId: number | null = null;
  private screenPanButtonMask = 0;
  private lastScreenPanPoint: PlatePoint | null = null;
  private screenPinchGesture: ScreenPinchGesture | null = null;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.renderShell();
    this.canvas = this.query<HTMLCanvasElement>(".wavefield-canvas");
    this.playButton = this.query<HTMLButtonElement>(".play-toggle");
    this.volumeButton = this.query<HTMLButtonElement>(".volume-toggle");
    this.volumeSlider = this.query<HTMLInputElement>(".volume-slider");
    this.sourceTrigger = this.query<HTMLButtonElement>(".source-trigger");
    this.sourceMenu = this.query<HTMLElement>(".source-menu");
    this.sourcePicker = this.query<HTMLElement>(".source-picker");
    this.selectedSource = this.query<HTMLElement>(".selected-source");
    this.fullscreenButton = this.query<HTMLButtonElement>(".fullscreen-toggle");
    this.settingsButton = this.query<HTMLButtonElement>(".settings-toggle");
    this.boundaryInputs = Array.from(
      this.root.querySelectorAll<HTMLInputElement>(".boundary-radio-input"),
    );
    this.settingsModal = this.query<HTMLElement>(".settings-modal");
    this.settingsPanel = this.query<HTMLElement>(".settings-panel");
    this.settingsCloseButton = this.query<HTMLButtonElement>(".settings-close");
    this.desktopDriveHost = this.query<HTMLElement>(".desktop-drive-host");
    this.mobileDriveHost = this.query<HTMLElement>(".mobile-drive-host");
    this.drivePane = this.query<HTMLDetailsElement>(".drive-pane");
    this.driveSummaryValue = this.query<HTMLElement>(".drive-summary-value");
    this.driveModeSelect = this.query<HTMLSelectElement>(".drive-mode-select");
    this.modeSettingsHost = this.query<HTMLElement>(".mode-settings-host");
    this.transport = this.query<HTMLElement>(".transport");
    this.guiHost = this.query<HTMLElement>(".pane-host");

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(DEFAULT_SETTINGS.backgroundColor, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.syncBackgroundColor();

    this.wavesurfer = WaveSurfer.create({
      container: this.query<HTMLElement>(".waveform"),
      height: 62,
      normalize: true,
      waveColor: "#29313a",
      progressColor: "#d9f7ff",
      cursorColor: "#ffffff",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });

    this.controls = createControls(
      this.guiHost,
      this.settings,
      () => this.handleSettingsChange(),
      this.monitorState,
      {
        isDev: import.meta.env.DEV,
        saveState: this.templateSaveState,
        templates: this.templates,
        onApplyTemplate: (template) => this.applyTemplate(template),
        onDeleteTemplate: (template) => this.deleteTemplate(template),
        onResaveTemplate: (template) => this.resaveTemplate(template),
        onSaveTemplate: (name) => this.saveTemplate(name),
      },
    );

    this.bindUi();
    this.syncHeaderControls();
    this.syncSettingsMode();
    this.syncSettingsModal();
    this.fieldSettingsKey = getFieldSettingsKey(this.settings);
    this.resize();
  }

  start() {
    this.animationFrame = requestAnimationFrame(this.animate);
    void this.loadDefaultFixture();
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    this.canvas.removeEventListener("wheel", this.handleCanvasWheel);
    this.canvas.removeEventListener("pointerdown", this.handleCanvasPointerDown);
    this.canvas.removeEventListener("pointermove", this.handleCanvasPointerMove);
    this.canvas.removeEventListener("pointerup", this.handleCanvasPointerUp);
    this.canvas.removeEventListener("pointercancel", this.handleCanvasPointerUp);
    this.canvas.removeEventListener("click", this.handleCanvasClick);
    this.canvas.removeEventListener("contextmenu", this.handleCanvasContextMenu);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
    this.controls.dispose();
    this.disposeModeSettingsPane();
    this.liveAnalyzer.stop();
    this.modalRenderer.dispose();
    this.renderer.dispose();
    this.wavesurfer.destroy();
  }

  private renderShell() {
    const fixtureOptions = FIXTURES.map(
      (fixture) =>
        `<button class="source-option" type="button" role="option" data-fixture-url="${fixture.url}">
          <i class="ph ph-music-note-simple" aria-hidden="true"></i>
          <span>${fixture.label}</span>
        </button>`,
    ).join("");

    return `
      <main class="wavefield">
        <canvas class="wavefield-canvas" aria-label="Wavefield cymatic visualization"></canvas>
        <section class="topbar" aria-label="Wavefield controls">
          <button class="fullscreen-toggle" type="button" aria-label="Fullscreen" title="Fullscreen">
            <i class="ph ph-corners-out" aria-hidden="true"></i>
          </button>
          <div class="brand">
            <span class="brand-mark"></span>
            <span>Wavefield</span>
          </div>
          <div class="boundary-radio-group" role="radiogroup" aria-label="Boundary type">
            ${BOUNDARY_OPTIONS.map(
              (option) => `
                <label class="boundary-radio-option" title="${formatBoundaryMode(option.value)} boundary">
                  <input
                    class="boundary-radio-input"
                    type="radio"
                    name="boundary-mode"
                    value="${option.value}"
                    ${option.value === this.settings.boundaryMode ? "checked" : ""}
                  />
                  <span>${option.label}</span>
                </label>
              `,
            ).join("")}
          </div>
          <button
            class="settings-toggle"
            type="button"
            aria-label="Open settings"
            aria-controls="wavefield-settings-modal"
            aria-expanded="false"
            title="Settings"
          >
            <i class="ph ph-sliders-horizontal" aria-hidden="true"></i>
          </button>
        </section>
        <section
          class="settings-modal"
          id="wavefield-settings-modal"
          aria-hidden="true"
          hidden
        >
          <aside
            class="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wavefield-settings-title"
            tabindex="-1"
          >
            <header class="settings-panel-header">
              <h2 id="wavefield-settings-title">Settings</h2>
              <button class="settings-close" type="button" aria-label="Close settings" title="Close settings">
                <i class="ph ph-x" aria-hidden="true"></i>
              </button>
            </header>
            <div class="mobile-drive-host" aria-label="Drive settings"></div>
            <div class="pane-host" aria-label="Wavefield shader settings"></div>
          </aside>
        </section>
        <section class="diagnostics-strip" aria-label="Wavefield diagnostics">
          <div class="desktop-drive-host">
            <details class="drive-pane">
              <summary class="drive-pane-summary">
                <span class="drive-pane-title">
                  <i class="ph ph-wave-sine" aria-hidden="true"></i>
                  <span>Drive</span>
                </span>
                <span class="drive-summary-value">Manual</span>
                <i class="ph ph-caret-down drive-pane-caret" aria-hidden="true"></i>
              </summary>
              <div class="drive-pane-body">
                <label class="drive-mode-picker">
                  <span>Mode</span>
                  <select class="drive-mode-select" aria-label="Drive mode">
                    <option value="audio">Audio</option>
                    <option value="manual" selected>Manual</option>
                    <option value="live">Live</option>
                  </select>
                </label>
                <div class="source-picker" hidden>
                  <button class="source-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
                    <i class="ph ph-music-notes" aria-hidden="true"></i>
                    <span class="selected-source">Choose audio</span>
                    <i class="ph ph-caret-down" aria-hidden="true"></i>
                  </button>
                  <div class="source-menu" role="listbox" hidden>
                    ${fixtureOptions}
                    <button class="source-option upload-option" type="button" role="option">
                      <i class="ph ph-upload-simple" aria-hidden="true"></i>
                      <span>Upload audio...</span>
                    </button>
                  </div>
                  <input class="audio-file" type="file" accept="audio/*" />
                </div>
                <div class="mode-settings-host" aria-label="Drive mode settings" hidden></div>
              </div>
            </details>
          </div>
        </section>
        <section class="transport" aria-label="Audio transport">
          <button class="play-toggle" type="button" aria-label="Play" title="Play">
            <i class="ph ph-play" aria-hidden="true"></i>
          </button>
          <div class="volume-control">
            <button class="volume-toggle" type="button" aria-label="Mute" title="Mute">
              <i class="ph ph-speaker-high" aria-hidden="true"></i>
            </button>
            <div class="volume-popover">
              <input
                class="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value="1"
                aria-label="Volume"
                aria-orientation="vertical"
              />
            </div>
          </div>
          <div class="waveform"></div>
        </section>
      </main>
    `;
  }

  private bindUi() {
    window.addEventListener("resize", this.resize);

    this.sourceTrigger.addEventListener("click", () => {
      this.setSourceMenuOpen(this.sourceMenu.hasAttribute("hidden"));
    });

    document.addEventListener("click", (event) => {
      if (!this.sourcePicker.contains(event.target as Node)) {
        this.setSourceMenuOpen(false);
      }
    });

    this.driveModeSelect.addEventListener("change", () => {
      void this.setDriveMode(this.driveModeSelect.value as DriveMode);
    });

    this.boundaryInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) {
          this.setBoundaryMode(input.value as BoundaryMode);
        }
      });
    });

    this.drivePane.addEventListener("toggle", () => {
      this.modeSettingsPane?.refresh();
    });

    this.playButton.addEventListener("click", () => {
      this.togglePlayback();
    });

    this.volumeButton.addEventListener("click", () => {
      this.setMuted(!this.wavesurfer.getMuted());
    });

    this.fullscreenButton.addEventListener("click", () => {
      void this.toggleFullscreen();
    });

    this.settingsButton.addEventListener("click", () => {
      if (!this.isMobileSettings) {
        return;
      }
      this.setSettingsOpen(!this.isSettingsOpen, this.settingsButton);
    });

    this.settingsCloseButton.addEventListener("click", () => {
      this.setSettingsOpen(false);
    });

    this.volumeSlider.addEventListener("input", () => {
      this.setVolume(Number(this.volumeSlider.value));
    });

    this.canvas.addEventListener("wheel", this.handleCanvasWheel, {
      passive: false,
    });
    this.canvas.addEventListener("pointerdown", this.handleCanvasPointerDown);
    this.canvas.addEventListener("pointermove", this.handleCanvasPointerMove);
    this.canvas.addEventListener("pointerup", this.handleCanvasPointerUp);
    this.canvas.addEventListener("pointercancel", this.handleCanvasPointerUp);
    this.canvas.addEventListener("click", this.handleCanvasClick);
    this.canvas.addEventListener("contextmenu", this.handleCanvasContextMenu);

    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);

    this.root.querySelectorAll<HTMLButtonElement>("[data-fixture-url]").forEach((button) => {
      button.addEventListener("click", () => {
        const fixtureUrl = button.dataset.fixtureUrl;
        if (fixtureUrl) {
          this.setSourceMenuOpen(false);
          void this.loadFixture(fixtureUrl, button.textContent?.trim() ?? "fixture");
        }
      });
    });

    this.query<HTMLButtonElement>(".upload-option").addEventListener("click", () => {
      this.setSourceMenuOpen(false);
      this.query<HTMLInputElement>(".audio-file").click();
    });

    this.query<HTMLInputElement>(".audio-file").addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (file) {
        void this.loadFile(file);
      }
      input.value = "";
    });

    this.root.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.root.classList.add("is-dragging");
    });
    this.root.addEventListener("dragleave", () => {
      this.root.classList.remove("is-dragging");
    });
    this.root.addEventListener("drop", (event) => {
      event.preventDefault();
      this.root.classList.remove("is-dragging");
      const file = event.dataTransfer?.files[0];
      if (file?.type.startsWith("audio/")) {
        void this.loadFile(file);
      }
    });

    this.wavesurfer.on("ready", () => {
      this.setStatus(
        this.analysis
          ? `${formatDuration(this.analysis.duration)} ready`
          : "Audio ready",
      );
    });
    this.wavesurfer.on("play", () => {
      this.setPlayButton(true);
    });
    this.wavesurfer.on("pause", () => {
      this.setPlayButton(false);
    });
    this.wavesurfer.on("finish", () => {
      this.setPlayButton(false);
    });
    this.wavesurfer.on("seeking", (time) => {
      this.modalEngine.reset(time);
      this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
      this.resetVisualState();
    });
    this.wavesurfer.on("interaction", () => {
      const time = this.wavesurfer.getCurrentTime();
      this.modalEngine.reset(time);
    });
    this.wavesurfer.on("error", (error) => {
      this.setStatus(error instanceof Error ? error.message : String(error));
    });

    this.syncVolumeControl();
  }

  private async loadFixture(url: string, label: string) {
    this.setStatus(`Loading ${label}...`);
    this.updateSelectedSource(label);
    this.prepareForNewAudio();

    const analysisPromise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${label}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => decodeAndAnalyzeAudio(buffer));
    const wavePromise = this.wavesurfer.load(url);
    const [analysis] = await Promise.all([analysisPromise, wavePromise]);

    this.setAnalysis(analysis);
    this.setStatus(`${label} analyzed: ${analysis.frames.length} frames`);
  }

  private async loadDefaultFixture() {
    if (!DEFAULT_FIXTURE) {
      return;
    }

    try {
      await this.loadFixture(DEFAULT_FIXTURE.url, DEFAULT_FIXTURE.label);
    } catch (error) {
      this.setStatus(
        error instanceof Error
          ? error.message
          : "Could not load the default fixture",
      );
    }
  }

  private async loadFile(file: File) {
    this.setStatus(`Loading ${file.name}...`);
    this.updateSelectedSource(file.name);
    this.prepareForNewAudio();

    const analysisPromise = file
      .arrayBuffer()
      .then((buffer) => decodeAndAnalyzeAudio(buffer));
    const wavePromise = this.wavesurfer.loadBlob(file);
    const [analysis] = await Promise.all([analysisPromise, wavePromise]);

    this.setAnalysis(analysis);
    this.setStatus(`${file.name} analyzed: ${analysis.frames.length} frames`);
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
    this.setPlayButton(false);
    this.resetVisualState();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.repeat) {
      return;
    }

    if (this.isSettingsOpen && event.code === "Escape") {
      event.preventDefault();
      this.setSettingsOpen(false);
      return;
    }

    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    if (event.code === "Tab") {
      event.preventDefault();
      this.setSettingsOpen(!this.isSettingsOpen, this.settingsButton);
      return;
    }

    if (event.code === "KeyF") {
      event.preventDefault();
      void this.toggleFullscreen();
      return;
    }

    if (event.code !== "Space") {
      return;
    }
    event.preventDefault();
    this.togglePlayback();
  };

  private animate = (now: number) => {
    const deltaSeconds = Math.min(0.1, (now - this.lastFrameTime) / 1_000);
    this.lastFrameTime = now;
    const time = this.wavesurfer.getCurrentTime();
    const isPlaying = this.wavesurfer.isPlaying();
    const isManualDrive = this.settings.driveMode === "manual";
    const isLiveDrive = this.settings.driveMode === "live";
    let fieldFrame = this.lastModalFieldFrame;
    let renderDeltaSeconds = 0;
    let isIdlePreview = false;

    if (isManualDrive) {
      this.manualSeconds += deltaSeconds;
      fieldFrame = this.modalEngine.update(
        this.manualSeconds,
        this.settings,
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
          this.settings,
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
      fieldFrame = this.modalEngine.update(time, this.settings, deltaSeconds);
      this.lastModalFieldFrame = fieldFrame;
      renderDeltaSeconds = deltaSeconds;
    } else {
      if (fieldFrame.modes.length === 0) {
        const previewTime = time > 0.05 ? time : this.analysisPreviewTime;
        fieldFrame = this.modalEngine.update(previewTime, this.settings, 1 / 60);
        this.lastModalFieldFrame = fieldFrame;
      }
    }

    this.updateScreenViewDamping(deltaSeconds);
    this.updateMonitorState(fieldFrame);
    this.modalRenderer.render(
      this.renderer,
      fieldFrame,
      this.settings,
      this.screenView,
      renderDeltaSeconds,
      isIdlePreview,
    );

    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private updateMonitorState(fieldFrame: ModalFieldFrame) {
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

    // Diagnostics readouts (formerly the floating analysis-debug HUD).
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
        // Log-normalise across the audible band the engine spans (70–7200 Hz).
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

  private resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.modalRenderer.setSize(this.canvas.width, this.canvas.height);
    this.syncSettingsMode();
  };

  private query<T extends Element>(selector: string) {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing ${selector}`);
    }
    return element;
  }

  private setStatus(_message: string) {
    // Status messages are intentionally non-visual; the diagnostics strip is reserved for controls.
  }

  private setSourceMenuOpen(isOpen: boolean) {
    this.sourceMenu.hidden = !isOpen;
    this.sourceTrigger.setAttribute("aria-expanded", String(isOpen));
  }

  private updateSelectedSource(label: string) {
    this.selectedSource.textContent = label;
  }

  private setPlayButton(isPlaying: boolean) {
    const label = isPlaying ? "Pause" : "Play";
    this.playButton.innerHTML = `
      <i class="ph ${isPlaying ? "ph-pause" : "ph-play"}" aria-hidden="true"></i>
    `;
    this.playButton.setAttribute("aria-label", label);
    this.playButton.title = label;
  }

  private togglePlayback() {
    if (this.settings.driveMode !== "audio") {
      return;
    }

    void this.wavesurfer.playPause().catch((error: unknown) => {
      this.setStatus(
        error instanceof Error
          ? error.message
          : "Playback was blocked by the browser",
      );
    });
  }

  private setSettingsOpen(isOpen: boolean, trigger: HTMLElement | null = null) {
    if (this.isSettingsOpen === isOpen) {
      return;
    }

    this.isSettingsOpen = isOpen;
    this.lastSettingsTrigger = isOpen ? trigger : this.lastSettingsTrigger;
    this.syncSettingsModal();
  }

  private syncSettingsMode() {
    const isMobileSettings = this.mobileSettingsMedia.matches;
    if (this.isMobileSettings === isMobileSettings) {
      return;
    }

    this.isMobileSettings = isMobileSettings;
    this.syncDriveSettingsLocation();
    this.syncSettingsModal();
  }

  private syncSettingsModal() {
    const shouldShowMobileModal = this.isMobileSettings && this.isSettingsOpen;
    this.settingsModal.hidden = !this.isSettingsOpen;
    this.settingsModal.setAttribute(
      "aria-hidden",
      String(!this.isSettingsOpen),
    );
    this.settingsPanel.setAttribute(
      "role",
      this.isMobileSettings ? "dialog" : "complementary",
    );
    if (this.isMobileSettings) {
      this.settingsPanel.setAttribute("aria-modal", "true");
    } else {
      this.settingsPanel.removeAttribute("aria-modal");
    }
    this.settingsButton.hidden = !this.isMobileSettings;
    this.settingsButton.setAttribute("aria-expanded", String(shouldShowMobileModal));
    this.settingsButton.setAttribute(
      "aria-label",
      shouldShowMobileModal ? "Close settings" : "Open settings",
    );
    this.root.classList.toggle("is-settings-open", this.isSettingsOpen);
    this.root.classList.toggle("is-mobile-settings", this.isMobileSettings);

    if (this.isSettingsOpen) {
      this.controls.refresh();
      if (this.isMobileSettings) {
        requestAnimationFrame(() => {
          this.getSettingsFocusableElements()[0]?.focus();
        });
      }
      return;
    }

    if (this.isMobileSettings) {
      this.lastSettingsTrigger?.focus();
    }
  }

  private getSettingsFocusableElements() {
    return Array.from(
      this.settingsPanel.querySelectorAll<HTMLElement>(
        'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.offsetParent !== null,
    );
  }

  private syncDriveSettingsLocation() {
    const targetHost = this.isMobileSettings
      ? this.mobileDriveHost
      : this.desktopDriveHost;
    if (this.drivePane.parentElement !== targetHost) {
      targetHost.append(this.drivePane);
    }
  }

  private handleFullscreenChange = () => {
    const isFullscreen = document.fullscreenElement === this.root;
    if (isFullscreen) {
      this.setSettingsOpen(false);
    }
    this.root.classList.toggle("is-fullscreen", isFullscreen);
  };

  private async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await this.root.requestFullscreen();
    } catch (error) {
      this.setStatus(
        error instanceof Error ? error.message : "Fullscreen is unavailable",
      );
    }
  }

  private setVolume(volume: number) {
    const clampedVolume = Math.min(1, Math.max(0, volume));
    this.wavesurfer.setVolume(clampedVolume);
    if (clampedVolume > 0) {
      this.lastAudibleVolume = clampedVolume;
      this.wavesurfer.setMuted(false);
    } else {
      this.wavesurfer.setMuted(true);
    }
    this.syncVolumeControl();
  }

  private setMuted(isMuted: boolean) {
    if (!isMuted && this.wavesurfer.getVolume() <= 0) {
      this.wavesurfer.setVolume(this.lastAudibleVolume);
    }
    this.wavesurfer.setMuted(isMuted);
    this.syncVolumeControl();
  }

  private handleCanvasWheel = (event: WheelEvent) => {
    if (this.settings.projectionMode !== "screen") {
      return;
    }

    event.preventDefault();
    const anchor = this.getTransformedPlatePoint(event.clientX, event.clientY);
    const deltaY = normalizeWheelDelta(event);
    const nextScale = clamp(
      this.screenViewTarget.scale * Math.exp(-deltaY * SCREEN_WHEEL_ZOOM_SPEED),
      SCREEN_VIEW_MIN_SCALE,
      SCREEN_VIEW_MAX_SCALE,
    );
    if (nextScale === this.screenViewTarget.scale) {
      return;
    }

    this.setScreenViewTargetAtAnchor(nextScale, event.clientX, event.clientY, anchor);
  };

  private handleCanvasPointerDown = (event: PointerEvent) => {
    if (this.settings.projectionMode !== "screen") {
      return;
    }

    if (event.pointerType === "touch") {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      this.screenTouchPointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      this.screenPanPointerId = null;
      this.screenPanButtonMask = 0;
      this.lastScreenPanPoint =
        this.screenTouchPointers.size === 1
          ? this.getPlatePoint(event.clientX, event.clientY)
          : null;
      this.canvas.classList.add("is-panning-screen");
      this.canvas.setPointerCapture(event.pointerId);
      if (this.screenTouchPointers.size >= 2) {
        this.resetScreenPinchGesture();
      }
      return;
    }

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    event.preventDefault();
    this.screenPanPointerId = event.pointerId;
    this.screenPanButtonMask = event.button === 2 ? 2 : 1;
    this.lastScreenPanPoint = this.getPlatePoint(event.clientX, event.clientY);
    this.canvas.classList.add("is-panning-screen");
    this.canvas.setPointerCapture(event.pointerId);
  };

  private handleCanvasPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (
        this.settings.projectionMode !== "screen" ||
        !this.screenTouchPointers.has(event.pointerId)
      ) {
        return;
      }

      event.preventDefault();
      this.screenTouchPointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (this.screenTouchPointers.size >= 2) {
        this.applyScreenPinchGesture();
        return;
      }

      if (!this.lastScreenPanPoint) {
        this.lastScreenPanPoint = this.getPlatePoint(event.clientX, event.clientY);
        return;
      }

      const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
      this.panScreenViewTarget(nextPoint, this.lastScreenPanPoint);
      this.lastScreenPanPoint = nextPoint;
      return;
    }

    if (
      this.settings.projectionMode !== "screen" ||
      this.screenPanPointerId !== event.pointerId ||
      !this.lastScreenPanPoint ||
      (event.buttons & this.screenPanButtonMask) === 0
    ) {
      return;
    }

    event.preventDefault();
    const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
    this.panScreenViewTarget(nextPoint, this.lastScreenPanPoint);
    this.lastScreenPanPoint = nextPoint;
  };

  private handleCanvasPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (!this.screenTouchPointers.has(event.pointerId)) {
        return;
      }

      this.screenTouchPointers.delete(event.pointerId);
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }

      if (this.screenTouchPointers.size >= 2) {
        this.resetScreenPinchGesture();
        return;
      }

      this.screenPinchGesture = null;
      const remainingTouch = this.screenTouchPointers.values().next().value;
      this.lastScreenPanPoint = remainingTouch
        ? this.getPlatePoint(remainingTouch.clientX, remainingTouch.clientY)
        : null;
      if (!remainingTouch) {
        this.canvas.classList.remove("is-panning-screen");
      }
      return;
    }

    if (this.screenPanPointerId !== event.pointerId) {
      return;
    }

    this.screenPanPointerId = null;
    this.screenPanButtonMask = 0;
    this.lastScreenPanPoint = null;
    this.canvas.classList.remove("is-panning-screen");
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private handleCanvasClick = () => {
    if (this.drivePane.open) {
      this.drivePane.open = false;
    }
  };

  private handleCanvasContextMenu = (event: MouseEvent) => {
    if (this.settings.projectionMode === "screen") {
      event.preventDefault();
    }
  };

  private getTransformedPlatePoint(clientX: number, clientY: number): PlatePoint {
    const platePoint = this.getPlatePoint(clientX, clientY);
    return {
      x: (platePoint.x - 0.5) / this.screenView.scale + 0.5 + this.screenView.offsetX,
      y: (platePoint.y - 0.5) / this.screenView.scale + 0.5 + this.screenView.offsetY,
    };
  }

  private setScreenViewTargetAtAnchor(
    scale: number,
    clientX: number,
    clientY: number,
    anchor: PlatePoint,
  ) {
    const platePoint = this.getPlatePoint(clientX, clientY);
    this.screenViewTarget.scale = scale;
    this.screenViewTarget.offsetX =
      anchor.x - ((platePoint.x - 0.5) / scale + 0.5);
    this.screenViewTarget.offsetY =
      anchor.y - ((platePoint.y - 0.5) / scale + 0.5);
  }

  private panScreenViewTarget(nextPoint: PlatePoint, previousPoint: PlatePoint) {
    this.screenViewTarget.offsetX -=
      (nextPoint.x - previousPoint.x) / this.screenViewTarget.scale;
    this.screenViewTarget.offsetY -=
      (nextPoint.y - previousPoint.y) / this.screenViewTarget.scale;
  }

  private resetScreenPinchGesture() {
    const pinch = this.getScreenPinchSnapshot();
    if (!pinch) {
      this.screenPinchGesture = null;
      return;
    }

    this.screenPinchGesture = {
      distance: pinch.distance,
      scale: this.screenViewTarget.scale,
      anchor: this.getTransformedPlatePoint(pinch.midpointX, pinch.midpointY),
    };
  }

  private applyScreenPinchGesture() {
    const pinch = this.getScreenPinchSnapshot();
    if (!pinch) {
      return;
    }

    if (!this.screenPinchGesture) {
      this.resetScreenPinchGesture();
      return;
    }

    const nextScale = clamp(
      this.screenPinchGesture.scale *
        (pinch.distance / this.screenPinchGesture.distance),
      SCREEN_VIEW_MIN_SCALE,
      SCREEN_VIEW_MAX_SCALE,
    );
    this.setScreenViewTargetAtAnchor(
      nextScale,
      pinch.midpointX,
      pinch.midpointY,
      this.screenPinchGesture.anchor,
    );
  }

  private getScreenPinchSnapshot(): ScreenPinchSnapshot | null {
    const pointers = Array.from(this.screenTouchPointers.values());
    if (pointers.length < 2) {
      return null;
    }

    const [first, second] = pointers;
    const deltaX = second.clientX - first.clientX;
    const deltaY = second.clientY - first.clientY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < SCREEN_PINCH_MIN_DISTANCE) {
      return null;
    }

    return {
      distance,
      midpointX: (first.clientX + second.clientX) * 0.5,
      midpointY: (first.clientY + second.clientY) * 0.5,
    };
  }

  private updateScreenViewDamping(deltaSeconds: number) {
    if (this.settings.projectionMode !== "screen") {
      this.screenView.scale = this.screenViewTarget.scale;
      this.screenView.offsetX = this.screenViewTarget.offsetX;
      this.screenView.offsetY = this.screenViewTarget.offsetY;
      return;
    }

    const safeDeltaSeconds = Math.max(0, deltaSeconds);
    const panBlend = 1 - Math.exp(-SCREEN_PAN_DAMPING * safeDeltaSeconds);
    const zoomBlend = 1 - Math.exp(-SCREEN_ZOOM_DAMPING * safeDeltaSeconds);
    this.screenView.scale +=
      (this.screenViewTarget.scale - this.screenView.scale) * zoomBlend;
    this.screenView.offsetX +=
      (this.screenViewTarget.offsetX - this.screenView.offsetX) * panBlend;
    this.screenView.offsetY +=
      (this.screenViewTarget.offsetY - this.screenView.offsetY) * panBlend;
  }

  private getPlatePoint(clientX: number, clientY: number): PlatePoint {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const uvX = (clientX - rect.left) / width;
    const uvY = 1 - (clientY - rect.top) / height;

    if (this.settings.screenAspectMode === "circle") {
      const aspect = width / height;
      return {
        x: (uvX - 0.5) * aspect + 0.5,
        y: uvY,
      };
    }

    return { x: uvX, y: uvY };
  }

  private syncVolumeControl() {
    const volume = this.wavesurfer.getVolume();
    const isMuted = this.wavesurfer.getMuted() || volume <= 0;
    const effectiveVolume = isMuted ? 0 : volume;
    const icon = isMuted
      ? "ph-speaker-x"
      : volume < 0.5
        ? "ph-speaker-low"
        : "ph-speaker-high";
    const label = isMuted ? "Unmute" : "Mute";

    this.volumeSlider.value = String(effectiveVolume);
    this.volumeButton.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
    this.volumeButton.setAttribute("aria-label", label);
    this.volumeButton.title = label;
  }

  private applyTemplate(template: WavefieldTemplate) {
    const nextSettings = coerceCymaticSettings(template.settings);
    const currentDriveMode = this.settings.driveMode;

    Object.assign(this.settings, nextSettings);
    this.settings.driveMode = currentDriveMode;
    this.handleSettingsChange();
    this.setStatus(`Template: ${template.name}`);
  }

  private async saveTemplate(name: string) {
    const template = await this.writeTemplate(name);
    if (!template) {
      return;
    }

    this.templateSaveState.name = "";
    this.setStatus(`Saved template: ${template.name}`);
  }

  private async resaveTemplate(template: WavefieldTemplate) {
    const nextTemplate = await this.writeTemplate(template.name);
    if (!nextTemplate) {
      return;
    }

    this.setStatus(`Resaved template: ${nextTemplate.name}`);
  }

  private async writeTemplate(name: string) {
    if (!import.meta.env.DEV) {
      return null;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    const response = await fetch("/api/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: trimmedName,
        settings: cloneTemplateSettings(this.settings),
      }),
    });

    if (!response.ok) {
      throw new Error(await readTemplateApiError(response));
    }

    const body = (await response.json()) as { template?: unknown };
    const template = coerceWavefieldTemplate(body.template, "template");
    this.upsertTemplate(template);
    return template;
  }

  private async deleteTemplate(template: WavefieldTemplate) {
    if (!import.meta.env.DEV) {
      return;
    }

    const response = await fetch(
      `/api/templates/${encodeURIComponent(template.slug)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(await readTemplateApiError(response));
    }

    this.setTemplates(
      this.templates.filter((candidate) => candidate.slug !== template.slug),
    );
    this.setStatus(`Deleted template: ${template.name}`);
  }

  private upsertTemplate(template: WavefieldTemplate) {
    this.setTemplates([
      ...this.templates.filter((candidate) => candidate.slug !== template.slug),
      template,
    ]);
  }

  private setTemplates(templates: WavefieldTemplate[]) {
    this.templates.splice(
      0,
      this.templates.length,
      ...sortWavefieldTemplates(templates),
    );
    this.controls.refresh();
  }

  private handleSettingsChange() {
    const nextFieldSettingsKey = getFieldSettingsKey(this.settings);
    if (nextFieldSettingsKey !== this.fieldSettingsKey) {
      this.fieldSettingsKey = nextFieldSettingsKey;
      if (this.settings.driveMode === "manual") {
        this.manualSeconds = 0;
        this.modalEngine.reset(0);
      } else if (this.settings.driveMode === "live") {
        this.modalEngine.reset(this.liveSeconds);
      } else {
        this.modalEngine.reset(this.wavesurfer.getCurrentTime());
      }
      this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
      this.resetVisualState();
    }
    this.syncBackgroundColor();
    this.setStatus("Settings updated");
    this.syncHeaderControls();
  }

  private syncBackgroundColor() {
    const backgroundColor = normalizeHexColor(this.settings.backgroundColor);
    this.root.style.setProperty("--wavefield-background", backgroundColor);
    document.documentElement.style.setProperty(
      "--wavefield-background",
      backgroundColor,
    );
  }

  private syncHeaderControls() {
    this.driveModeSelect.value = this.settings.driveMode;
    this.boundaryInputs.forEach((input) => {
      input.checked = input.value === this.settings.boundaryMode;
    });
    this.driveSummaryValue.textContent = formatDriveMode(this.settings.driveMode);
    this.sourcePicker.hidden = this.settings.driveMode !== "audio";
    this.transport.hidden = this.settings.driveMode !== "audio";
    this.root.classList.toggle("is-audio-drive", this.settings.driveMode === "audio");
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
    if (this.settings.boundaryMode === boundaryMode) {
      this.syncHeaderControls();
      return;
    }

    this.settings.boundaryMode = boundaryMode;
    this.handleSettingsChange();
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
      this.wavesurfer.pause();
      this.setPlayButton(false);
    }
    if (driveMode !== "live") {
      this.liveAnalyzer.stop();
    }

    this.ambientSeconds = 0;
    this.manualSeconds = 0;
    this.liveSeconds = 0;
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.modalEngine.reset(driveMode === "audio" ? this.wavesurfer.getCurrentTime() : 0);
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
      this.modeSettingsHost.hidden = true;
      this.disposeModeSettingsPane();
      return;
    }

    this.modeSettingsHost.hidden = false;
    const nextLayoutKey = `manual:${this.settings.frequencySweep}`;
    if (this.modeSettingsPane && nextLayoutKey === this.modeSettingsLayoutKey) {
      this.modeSettingsPane.refresh();
      return;
    }

    this.disposeModeSettingsPane();
    this.modeSettingsLayoutKey = nextLayoutKey;
    this.modeSettingsPane = new Pane({
      container: this.modeSettingsHost,
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
    applyTooltipsByLabel(this.modeSettingsHost);
  }

  private disposeModeSettingsPane() {
    this.modeSettingsPane?.dispose();
    this.modeSettingsPane = null;
    this.modeSettingsLayoutKey = "";
  }
}

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatFixtureLabel(path: string) {
  const fileName = path.split("/").pop() ?? path;
  const label = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDriveMode(driveMode: DriveMode) {
  return driveMode[0].toUpperCase() + driveMode.slice(1);
}

function formatBoundaryMode(boundaryMode: BoundaryMode) {
  return (
    BOUNDARY_OPTIONS.find((option) => option.value === boundaryMode)?.label ??
    boundaryMode
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === event.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === event.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }

  return event.deltaY;
}

function getFirstMeaningfulFrameTime(analysis: AudioAnalysis) {
  return (
    analysis.frames.find(
      (frame) =>
        frame.peaks.length > 0 ||
        frame.signals.energy > 0.08 ||
        frame.signals.structure > 0.08,
    )?.time ?? 0
  );
}

function getFieldSettingsKey(settings: CymaticSettings) {
  return [settings.driveMode, settings.boundaryMode].join(":");
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest("input, select, textarea, [contenteditable=''], [contenteditable='true']"),
  );
}

function normalizeHexColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_SETTINGS.backgroundColor;
}

async function readTemplateApiError(response: Response) {
  const fallback = `Template request failed (${response.status})`;
  const text = await response.text();
  if (!text.trim()) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return text;
  }
}

type PlatePoint = {
  x: number;
  y: number;
};

type ScreenPointer = {
  clientX: number;
  clientY: number;
};

type ScreenPinchGesture = {
  distance: number;
  scale: number;
  anchor: PlatePoint;
};

type ScreenPinchSnapshot = {
  distance: number;
  midpointX: number;
  midpointY: number;
};
