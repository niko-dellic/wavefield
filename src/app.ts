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
import {
  BOUNDARY_TRANSITION_STORAGE_KEY,
  DEFAULT_BOUNDARY_TRANSITION_CONFIG,
  coerceBoundaryTransitionConfig,
  type BoundaryTransitionConfig,
} from "./boundaryTransition";
import { AUDIO_CONTROLS, DEFAULT_SETTINGS } from "./config/settings";
import {
  KEYBIND_STORAGE_KEY,
  assignKeyBinding,
  buildKeyCommands,
  clearKeyBinding,
  coerceKeyBindings,
  createTemplateApplyCommandId,
  getCommandForKey,
  getKeyboardEventCode,
  type KeyBindingMap,
  type KeyCommand,
  type KeyCommandId,
} from "./keybindings";
import {
  applyTooltipsByLabel,
  createControls,
  type ControlsManager,
  type MonitorState,
} from "./ui/controls";
import {
  cloneCymaticSettings,
  cloneTemplateSettings,
  coerceWavefieldTemplate,
  createSettingsFromTemplate,
  getCycledTemplateIndex,
  loadWavefieldTemplates,
  sortWavefieldTemplates,
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
  type TemplateTransitionEasing,
  type TemplateTransitionState,
} from "./templateTransition";
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

const SCREEN_VIEW_MIN_SCALE = 0.05;
const SCREEN_VIEW_MAX_SCALE = 16;
const SCREEN_WHEEL_ZOOM_SPEED = 0.0015;
const SCREEN_PINCH_MIN_DISTANCE = 8;
const SCREEN_PAN_DAMPING = 4.5;
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
  {
    label: "Free",
    value: "freePlate",
    shortcut: "1",
    title: "Free Plate resonance: antisymmetric Chladni-like plate family.",
  },
  {
    label: "Pinned",
    value: "dirichlet",
    shortcut: "2",
    title: "Pinned resonance: edge-constrained sine family.",
  },
  {
    label: "Open",
    value: "neumann",
    shortcut: "3",
    title: "Open Edge resonance: edge-bright cosine family.",
  },
  {
    label: "Clamped",
    value: "clamped",
    shortcut: "4",
    title: "Clamped resonance: edge-damped constrained family.",
  },
  {
    label: "Supported",
    value: "supported",
    shortcut: "5",
    title:
      "Supported resonance: zero-edge plate family with richer cross-mode symmetry.",
  },
] satisfies Array<{
  label: string;
  value: BoundaryMode;
  shortcut: string;
  title: string;
}>;
const TRANSITION_EASING_OPTIONS = [
  { label: "Linear", value: "linear" },
  { label: "Ease in", value: "easeIn" },
  { label: "Ease out", value: "easeOut" },
  { label: "Ease in/out", value: "easeInOut" },
] satisfies Array<{ label: string; value: TemplateTransitionEasing }>;

export class WavefieldApp {
  private readonly settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  private effectiveSettings: EffectiveCymaticSettings =
    createEffectiveCymaticSettings(this.settings);
  private readonly templates: WavefieldTemplate[] = [...INITIAL_TEMPLATES];
  private readonly templateSaveState = { name: "" };
  private templateTransitionConfig: TemplateTransitionConfig =
    loadTemplateTransitionConfig();
  private templateTransition: TemplateTransitionState | null = null;
  private boundaryTransitionConfig: BoundaryTransitionConfig =
    loadBoundaryTransitionConfig();
  private boundaryTransition: TemplateTransitionState | null = null;
  private keyCommands: KeyCommand[] = buildKeyCommands(this.templates);
  private keyBindings: KeyBindingMap = loadKeyBindings(this.keyCommands);
  private capturingKeybindSlug: string | null = null;
  private activeTemplateSlug: string | null = null;
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
  private readonly aboutButton: HTMLButtonElement;
  private readonly aboutModal: HTMLElement;
  private readonly aboutPanel: HTMLElement;
  private readonly aboutCloseButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly boundaryInputs: HTMLInputElement[];
  private readonly boundaryMorphInput: HTMLInputElement;
  private readonly boundaryMorphPaneHost: HTMLElement;
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
  private readonly mobileSettingsMedia = window.matchMedia(
    MOBILE_SETTINGS_MEDIA,
  );
  private modeSettingsPane: Pane | null = null;
  private modeSettingsLayoutKey = "";
  private boundaryMorphPane: Pane | null = null;
  private isAboutOpen = false;
  private isSettingsOpen = false;
  private isMobileSettings = false;
  private isFullscreenUiVisible = false;
  private lastAboutTrigger: HTMLElement | null = null;
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
  private isScreenPointerLocked = false;
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
    this.aboutButton = this.query<HTMLButtonElement>(".about-toggle");
    this.aboutModal = this.query<HTMLElement>(".about-modal");
    this.aboutPanel = this.query<HTMLElement>(".about-panel");
    this.aboutCloseButton = this.query<HTMLButtonElement>(".about-close");
    this.settingsButton = this.query<HTMLButtonElement>(".settings-toggle");
    this.boundaryInputs = Array.from(
      this.root.querySelectorAll<HTMLInputElement>(".boundary-radio-input"),
    );
    this.boundaryMorphInput = this.query<HTMLInputElement>(
      ".boundary-morph-input",
    );
    this.boundaryMorphPaneHost = this.query<HTMLElement>(
      ".boundary-morph-pane-host",
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
      () => ({
        isDev: import.meta.env.DEV,
        saveState: this.templateSaveState,
        transitionConfig: this.templateTransitionConfig,
        keyBindings: this.keyBindings,
        capturingKeybindSlug: this.capturingKeybindSlug,
        activeTemplateSlug: this.activeTemplateSlug,
        templates: this.templates,
        onApplyTemplate: (template) => this.startTemplateTransition(template),
        onDeleteTemplate: (template) => this.deleteTemplate(template),
        onResaveTemplate: (template) => this.resaveTemplate(template),
        onSaveTemplate: (name) => this.saveTemplate(name),
        onStartTemplateKeyCapture: (template) =>
          this.startTemplateKeyCapture(template),
        onTransitionConfigChange: (config) =>
          this.setTemplateTransitionConfig(config),
      }),
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
    this.canvas.removeEventListener(
      "pointerdown",
      this.handleCanvasPointerDown,
    );
    this.canvas.removeEventListener(
      "pointermove",
      this.handleCanvasPointerMove,
    );
    this.canvas.removeEventListener("pointerup", this.handleCanvasPointerUp);
    this.canvas.removeEventListener(
      "pointercancel",
      this.handleCanvasPointerUp,
    );
    this.canvas.removeEventListener("click", this.handleCanvasClick);
    this.canvas.removeEventListener(
      "contextmenu",
      this.handleCanvasContextMenu,
    );
    window.removeEventListener("resize", this.resize);
    document.removeEventListener(
      "mousemove",
      this.handleScreenPointerLockedMouseMove,
    );
    document.removeEventListener(
      "mouseup",
      this.handleScreenPointerLockedMouseUp,
    );
    document.removeEventListener("keydown", this.handleKeyDown, true);
    document.removeEventListener(
      "fullscreenchange",
      this.handleFullscreenChange,
    );
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    document.removeEventListener(
      "pointerlockerror",
      this.handlePointerLockError,
    );
    this.releaseScreenPointerLock();
    this.controls.dispose();
    this.disposeBoundaryMorphPane();
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
          <button
            class="about-toggle"
            type="button"
            aria-label="About Wavefield"
            aria-controls="wavefield-about-modal"
            aria-expanded="false"
            title="About"
          >
            <i class="ph ph-info" aria-hidden="true"></i>
          </button>
          <div class="brand">
            <span class="brand-mark"></span>
            <span>Wavefield</span>
          </div>
          <div class="boundary-radio-group" role="radiogroup" aria-label="Resonance style">
            ${BOUNDARY_OPTIONS.map(
              (option) => `
                <label class="boundary-radio-option" title="${option.title} (${option.shortcut})">
                  <input
                    class="boundary-radio-input"
                    type="radio"
                    name="boundary-mode"
                    value="${option.value}"
                    ${option.value === this.settings.boundaryMode ? "checked" : ""}
                  />
                  <span class="boundary-radio-shortcut">${option.shortcut}</span>
                  <span class="boundary-radio-title">${option.label}</span>
                </label>
              `,
            ).join("")}
          </div>
          <div class="boundary-morph-controls" aria-label="Resonance morph controls">
            <label class="boundary-morph-toggle" title="Lerp direct resonance changes">
              <input
                class="boundary-morph-input"
                type="checkbox"
                ${this.boundaryTransitionConfig.enabled ? "checked" : ""}
              />
              <span>Morph</span>
            </label>
          </div>
          <div class="boundary-morph-pane-host" aria-label="Resonance morph settings" hidden></div>
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
        <section
          class="about-modal"
          id="wavefield-about-modal"
          aria-hidden="true"
          hidden
        >
          <aside
            class="about-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wavefield-about-title"
            tabindex="-1"
          >
            <header class="about-panel-header">
              <h2 id="wavefield-about-title">About Wavefield</h2>
              <button class="about-close" type="button" aria-label="Close about" title="Close about">
                <i class="ph ph-x" aria-hidden="true"></i>
              </button>
            </header>
            <div class="about-body">
              <p class="about-copy">
                Wavefield explores the visible patterns that emerge when vibration organizes matter into
                standing waves, nodal lines, and shifting fields of resonance. While not true to physics, Wavefield takes inspiration from cymatics, the study of visible sound and vibration.
              </p>
              <p class="about-credit">Made by Niko in 2026.</p>
              <a
                class="about-link"
                href="https://github.com/niko-dellic"
                target="_blank"
                rel="noreferrer"
              >
                <i class="ph ph-github-logo" aria-hidden="true"></i>
                <span>github.com/niko-dellic</span>
              </a>
            </div>
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
    this.boundaryMorphInput.addEventListener("change", () => {
      this.setBoundaryTransitionConfig({
        ...this.boundaryTransitionConfig,
        enabled: this.boundaryMorphInput.checked,
      });
    });
    this.boundaryMorphPaneHost.addEventListener("change", (event) => {
      blurControlTarget(event.target);
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

    this.aboutButton.addEventListener("click", () => {
      this.setAboutOpen(true, this.aboutButton);
    });

    this.aboutCloseButton.addEventListener("click", () => {
      this.setAboutOpen(false);
    });

    this.aboutModal.addEventListener("click", (event) => {
      if (!this.aboutPanel.contains(event.target as Node)) {
        this.setAboutOpen(false);
      }
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

    document.addEventListener(
      "mousemove",
      this.handleScreenPointerLockedMouseMove,
    );
    document.addEventListener("mouseup", this.handleScreenPointerLockedMouseUp);
    document.addEventListener("keydown", this.handleKeyDown, true);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    document.addEventListener("pointerlockerror", this.handlePointerLockError);

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-fixture-url]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const fixtureUrl = button.dataset.fixtureUrl;
          if (fixtureUrl) {
            this.setSourceMenuOpen(false);
            void this.loadFixture(
              fixtureUrl,
              button.textContent?.trim() ?? "fixture",
            );
          }
        });
      });

    this.query<HTMLButtonElement>(".upload-option").addEventListener(
      "click",
      () => {
        this.setSourceMenuOpen(false);
        this.query<HTMLInputElement>(".audio-file").click();
      },
    );

    this.query<HTMLInputElement>(".audio-file").addEventListener(
      "change",
      (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
          void this.loadFile(file);
        }
        input.value = "";
      },
    );

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
    if (this.capturingKeybindSlug) {
      this.handleTemplateKeyCapture(event);
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.repeat) {
      return;
    }

    if (this.isAboutOpen && event.code === "Escape") {
      event.preventDefault();
      this.setAboutOpen(false);
      return;
    }

    if (this.isSettingsOpen && event.code === "Escape") {
      event.preventDefault();
      this.setSettingsOpen(false);
      return;
    }

    const keyCode = getKeyboardEventCode(event);
    const command = getCommandForKey(
      this.keyCommands,
      this.keyBindings,
      keyCode,
    );
    if (!command) {
      return;
    }

    if (isTextEntryKeyboardTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.runKeyCommand(command.id);
  };

  private animate = (now: number) => {
    const deltaSeconds = Math.min(0.1, (now - this.lastFrameTime) / 1_000);
    this.lastFrameTime = now;
    const renderSettings = this.updateTemplateTransition(deltaSeconds);
    const time = this.wavesurfer.getCurrentTime();
    const isPlaying = this.wavesurfer.isPlaying();
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
    } else {
      if (fieldFrame.modes.length === 0) {
        const previewTime = time > 0.05 ? time : this.analysisPreviewTime;
        fieldFrame = this.modalEngine.update(
          previewTime,
          renderSettings,
          1 / 60,
        );
        this.lastModalFieldFrame = fieldFrame;
      }
    }

    this.updateScreenViewDamping(deltaSeconds);
    // The Status monitors live inside the settings panel, which is hidden by
    // default (Tab to open). Skip the per-frame string/number formatting when
    // nothing is displaying it; readouts resume as soon as the panel opens.
    if (this.isSettingsOpen) {
      this.updateMonitorState(fieldFrame);
    }
    this.modalRenderer.render(
      this.renderer,
      fieldFrame,
      renderSettings,
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

  private setAboutOpen(isOpen: boolean, trigger: HTMLElement | null = null) {
    if (this.isAboutOpen === isOpen) {
      return;
    }

    this.isAboutOpen = isOpen;
    this.lastAboutTrigger = isOpen ? trigger : this.lastAboutTrigger;
    this.syncAboutModal();
  }

  private syncAboutModal() {
    this.aboutModal.hidden = !this.isAboutOpen;
    this.aboutModal.setAttribute("aria-hidden", String(!this.isAboutOpen));
    this.aboutButton.setAttribute("aria-expanded", String(this.isAboutOpen));
    this.root.classList.toggle("is-about-open", this.isAboutOpen);

    if (this.isAboutOpen) {
      requestAnimationFrame(() => {
        this.getAboutFocusableElements()[0]?.focus();
      });
      return;
    }

    this.lastAboutTrigger?.focus();
  }

  private getAboutFocusableElements() {
    return Array.from(
      this.aboutPanel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.offsetParent !== null,
    );
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
    this.settingsButton.setAttribute(
      "aria-expanded",
      String(shouldShowMobileModal),
    );
    this.settingsButton.setAttribute(
      "aria-label",
      shouldShowMobileModal ? "Close settings" : "Open settings",
    );
    this.root.classList.toggle("is-settings-open", this.isSettingsOpen);
    this.root.classList.toggle("is-mobile-settings", this.isMobileSettings);
    this.root.classList.toggle(
      "is-fullscreen-ui-visible",
      this.isFullscreenUiVisible,
    );

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
      this.setFullscreenUiVisible(false);
    } else {
      this.isFullscreenUiVisible = false;
      this.root.classList.remove("is-fullscreen-ui-visible");
    }
    this.root.classList.toggle("is-fullscreen", isFullscreen);
  };

  private setFullscreenUiVisible(isVisible: boolean) {
    if (
      this.isFullscreenUiVisible === isVisible &&
      this.isSettingsOpen === isVisible
    ) {
      return;
    }

    this.isFullscreenUiVisible = isVisible;
    this.setSettingsOpen(isVisible, this.settingsButton);
    this.root.classList.toggle("is-fullscreen-ui-visible", isVisible);
  }

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

    this.setScreenViewTargetAtAnchor(
      nextScale,
      event.clientX,
      event.clientY,
      anchor,
    );
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
    if (event.pointerType === "mouse") {
      this.requestScreenPointerLock();
    }
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
        this.lastScreenPanPoint = this.getPlatePoint(
          event.clientX,
          event.clientY,
        );
        return;
      }

      const nextPoint = this.getPlatePoint(event.clientX, event.clientY);
      this.panScreenViewTarget(nextPoint, this.lastScreenPanPoint);
      this.lastScreenPanPoint = nextPoint;
      return;
    }

    if (
      this.settings.projectionMode !== "screen" ||
      this.isScreenPointerLocked ||
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
    this.releaseScreenPointerLock();
  };

  private handleScreenPointerLockedMouseMove = (event: MouseEvent) => {
    if (
      this.settings.projectionMode !== "screen" ||
      !this.isScreenPointerLocked ||
      this.screenPanButtonMask === 0 ||
      (event.buttons & this.screenPanButtonMask) === 0
    ) {
      return;
    }

    event.preventDefault();
    this.panScreenViewTargetByPixels(event.movementX, event.movementY);
  };

  private handleScreenPointerLockedMouseUp = () => {
    if (!this.isScreenPointerLocked) {
      return;
    }

    this.endMouseScreenPan();
  };

  private handlePointerLockChange = () => {
    this.isScreenPointerLocked = document.pointerLockElement === this.canvas;
    if (this.isScreenPointerLocked) {
      this.lastScreenPanPoint = null;
      return;
    }

    if (this.screenPanPointerId !== null && this.screenPanButtonMask !== 0) {
      this.endMouseScreenPan();
    }
  };

  private handlePointerLockError = () => {
    this.isScreenPointerLocked = false;
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

  private getTransformedPlatePoint(
    clientX: number,
    clientY: number,
  ): PlatePoint {
    const platePoint = this.getPlatePoint(clientX, clientY);
    return {
      x:
        (platePoint.x - 0.5) / this.screenView.scale +
        0.5 +
        this.screenView.offsetX,
      y:
        (platePoint.y - 0.5) / this.screenView.scale +
        0.5 +
        this.screenView.offsetY,
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

  private panScreenViewTarget(
    nextPoint: PlatePoint,
    previousPoint: PlatePoint,
  ) {
    this.screenViewTarget.offsetX -=
      (nextPoint.x - previousPoint.x) / this.screenViewTarget.scale;
    this.screenViewTarget.offsetY -=
      (nextPoint.y - previousPoint.y) / this.screenViewTarget.scale;
  }

  private panScreenViewTargetByPixels(deltaX: number, deltaY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const xScale = this.settings.screenAspectMode === "circle" ? height : width;

    this.screenViewTarget.offsetX -=
      deltaX / xScale / this.screenViewTarget.scale;
    this.screenViewTarget.offsetY +=
      deltaY / height / this.screenViewTarget.scale;
  }

  private requestScreenPointerLock() {
    if (typeof this.canvas.requestPointerLock !== "function") {
      this.isScreenPointerLocked = false;
      return;
    }

    if (document.pointerLockElement === this.canvas) {
      this.isScreenPointerLocked = true;
      return;
    }

    try {
      this.canvas.requestPointerLock();
    } catch {
      this.isScreenPointerLocked = false;
    }
  }

  private releaseScreenPointerLock() {
    if (
      document.pointerLockElement === this.canvas &&
      typeof document.exitPointerLock === "function"
    ) {
      document.exitPointerLock();
    }
    this.isScreenPointerLocked = false;
  }

  private endMouseScreenPan() {
    const pointerId = this.screenPanPointerId;
    this.screenPanPointerId = null;
    this.screenPanButtonMask = 0;
    this.lastScreenPanPoint = null;
    this.canvas.classList.remove("is-panning-screen");
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.releaseScreenPointerLock();
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

  private startTemplateTransition(template: WavefieldTemplate) {
    const nextSettings = createSettingsFromTemplate(
      template.settings,
      this.settings,
    );
    const shouldApplyBoundaryMode =
      this.templateTransitionConfig.applyBoundaryMode;
    this.boundaryTransition = null;
    this.templateTransition = createTemplateTransition(
      this.effectiveSettings,
      nextSettings,
      this.templateTransitionConfig,
    );
    this.activeTemplateSlug = template.slug;
    this.setStatus(`Template: ${template.name}`);
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

  private cycleTemplate(direction: -1 | 1) {
    if (this.templates.length === 0) {
      return;
    }

    const nextIndex = getCycledTemplateIndex(
      this.templates,
      this.activeTemplateSlug,
      direction,
    );
    if (nextIndex >= 0) {
      this.startTemplateTransition(this.templates[nextIndex]);
    }
  }

  private runKeyCommand(commandId: KeyCommandId) {
    if (commandId === "ui.settings") {
      if (document.fullscreenElement === this.root) {
        this.setFullscreenUiVisible(!this.isFullscreenUiVisible);
        return;
      }

      this.setSettingsOpen(!this.isSettingsOpen, this.settingsButton);
      return;
    }

    if (commandId === "ui.fullscreen") {
      void this.toggleFullscreen();
      return;
    }

    if (commandId === "audio.playback") {
      this.togglePlayback();
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
      this.cycleTemplate(-1);
      return;
    }

    if (commandId === "template.next") {
      this.cycleTemplate(1);
      return;
    }

    if (commandId.startsWith("template.apply.")) {
      const slug = commandId.slice("template.apply.".length);
      const template = this.templates.find(
        (candidate) => candidate.slug === slug,
      );
      if (template) {
        this.startTemplateTransition(template);
      }
    }
  }

  private startTemplateKeyCapture(template: WavefieldTemplate) {
    this.capturingKeybindSlug = template.slug;
    this.controls.refresh();
    this.setStatus(`Press a key for ${template.name}`);
  }

  private handleTemplateKeyCapture(event: KeyboardEvent) {
    event.preventDefault();
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const slug = this.capturingKeybindSlug;
    if (!slug) {
      return;
    }

    const keyCode = getKeyboardEventCode(event);

    if (keyCode === "Escape") {
      this.capturingKeybindSlug = null;
      this.controls.refresh();
      return;
    }

    const commandId = createTemplateApplyCommandId(slug);
    if (keyCode === "Backspace" || keyCode === "Delete") {
      this.setKeyBindings(clearKeyBinding(this.keyBindings, commandId));
      this.capturingKeybindSlug = null;
      this.controls.refresh();
      return;
    }

    const assignment = assignKeyBinding(
      this.keyCommands,
      this.keyBindings,
      commandId,
      keyCode,
    );
    if (!assignment.ok) {
      this.setStatus(`Key already used by ${assignment.conflictLabel}`);
      return;
    }

    this.setKeyBindings(assignment.bindings);
    this.capturingKeybindSlug = null;
    this.controls.refresh();
  }

  private setKeyBindings(bindings: KeyBindingMap) {
    this.keyBindings = bindings;
    saveJsonToLocalStorage(KEYBIND_STORAGE_KEY, this.keyBindings);
  }

  private setTemplateTransitionConfig(config: TemplateTransitionConfig) {
    this.templateTransitionConfig = coerceTemplateTransitionConfig(config);
    saveJsonToLocalStorage(
      TEMPLATE_TRANSITION_STORAGE_KEY,
      this.templateTransitionConfig,
    );
    this.controls.refresh();
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
        settings: cloneTemplateSettings(this.effectiveSettings),
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
    this.keyCommands = buildKeyCommands(this.templates);
    this.setKeyBindings(coerceKeyBindings(this.keyBindings, this.keyCommands));
    if (
      this.activeTemplateSlug &&
      !this.templates.some(
        (template) => template.slug === this.activeTemplateSlug,
      )
    ) {
      this.activeTemplateSlug = null;
    }
    this.controls.refresh();
  }

  private handleSettingsChange() {
    this.templateTransition = null;
    this.boundaryTransition = null;
    this.effectiveSettings = createEffectiveCymaticSettings(this.settings);
    if (this.settings.projectionMode !== "screen") {
      this.endMouseScreenPan();
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
        this.modalEngine.reset(this.wavesurfer.getCurrentTime());
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
    this.driveModeSelect.value = this.settings.driveMode;
    this.boundaryInputs.forEach((input) => {
      input.checked = input.value === this.settings.boundaryMode;
    });
    this.boundaryMorphInput.checked = this.boundaryTransitionConfig.enabled;
    this.driveSummaryValue.textContent = formatDriveMode(
      this.settings.driveMode,
    );
    this.sourcePicker.hidden = this.settings.driveMode !== "audio";
    this.transport.hidden = this.settings.driveMode !== "audio";
    this.root.classList.toggle(
      "is-audio-drive",
      this.settings.driveMode === "audio",
    );
    this.root.classList.toggle(
      "is-live-recording",
      this.settings.driveMode === "live" && this.liveAnalyzer.isActive,
    );
    this.syncBoundaryMorphPane();
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
    this.activeTemplateSlug = null;
    this.settings.boundaryMode = boundaryMode;
    this.handleSettingsChange();
    if (shouldMorph) {
      this.boundaryTransition = createTemplateTransition(
        sourceSettings,
        this.settings,
        this.boundaryTransitionConfig,
      );
      this.effectiveSettings = sourceSettings;
      this.syncBackgroundColor(this.effectiveSettings);
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
    this.modalEngine.reset(
      driveMode === "audio" ? this.wavesurfer.getCurrentTime() : 0,
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

  private syncBoundaryMorphPane() {
    if (!this.boundaryTransitionConfig.enabled) {
      this.boundaryMorphPaneHost.hidden = true;
      this.disposeBoundaryMorphPane();
      return;
    }

    this.boundaryMorphPaneHost.hidden = false;
    if (this.boundaryMorphPane) {
      this.boundaryMorphPane.refresh();
      return;
    }

    this.boundaryMorphPane = new Pane({
      container: this.boundaryMorphPaneHost,
    });
    this.boundaryMorphPane.addBinding(
      this.boundaryTransitionConfig,
      "durationSeconds",
      {
        label: "duration",
        min: 0,
        max: 12,
        step: 0.05,
      },
    );
    this.boundaryMorphPane.addBinding(this.boundaryTransitionConfig, "easing", {
      label: "easing",
      options: getTransitionEasingOptions(),
    });
    this.boundaryMorphPane.on("change", () => {
      this.setBoundaryTransitionConfig(this.boundaryTransitionConfig);
    });
    applyTooltipsByLabel(this.boundaryMorphPaneHost);
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

  private disposeBoundaryMorphPane() {
    this.boundaryMorphPane?.dispose();
    this.boundaryMorphPane = null;
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

function getTransitionEasingOptions() {
  return Object.fromEntries(
    TRANSITION_EASING_OPTIONS.map((option) => [option.label, option.value]),
  ) as Record<string, TemplateTransitionEasing>;
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

function blurControlTarget(target: EventTarget | null) {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement
  ) {
    target.blur();
  }
}

function normalizeHexColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : DEFAULT_SETTINGS.backgroundColor;
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

function loadTemplateTransitionConfig() {
  try {
    const rawValue = window.localStorage.getItem(
      TEMPLATE_TRANSITION_STORAGE_KEY,
    );
    return coerceTemplateTransitionConfig(
      rawValue ? JSON.parse(rawValue) : DEFAULT_TEMPLATE_TRANSITION_CONFIG,
    );
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

function loadKeyBindings(commands: KeyCommand[]) {
  try {
    const rawValue = window.localStorage.getItem(KEYBIND_STORAGE_KEY);
    return coerceKeyBindings(rawValue ? JSON.parse(rawValue) : {}, commands);
  } catch {
    return coerceKeyBindings({}, commands);
  }
}

function saveJsonToLocalStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is a convenience; storage failures should not break
    // rendering or controls.
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
