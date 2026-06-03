import * as THREE from "three";
import WaveSurfer from "wavesurfer.js";

import {
  EMPTY_MODAL_FIELD_FRAME,
  ModalFieldEngine,
  createAmbientModalFieldFrame,
  type ModalFieldFrame,
} from "./audio/ModalField";
import { decodeAndAnalyzeAudio } from "./audio/analyze";
import { DEFAULT_SETTINGS } from "./config/settings";
import { createControls, type ControlsManager } from "./ui/controls";
import {
  ModalFieldRenderer,
  type ScreenViewTransform,
} from "./webgl/ModalFieldRenderer";
import type { AudioAnalysis, CymaticSettings } from "./types";

const SCREEN_VIEW_MIN_SCALE = 0.25;
const SCREEN_VIEW_MAX_SCALE = 16;
const SCREEN_WHEEL_ZOOM_SPEED = 0.0015;
const SCREEN_PAN_DAMPING = 10;
const SCREEN_ZOOM_DAMPING = 14;

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

export class WavefieldApp {
  private readonly settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  private readonly modalEngine = new ModalFieldEngine();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly modalRenderer = new ModalFieldRenderer();
  private readonly wavesurfer: WaveSurfer;
  private readonly controls: ControlsManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly volumeButton: HTMLButtonElement;
  private readonly volumeSlider: HTMLInputElement;
  private readonly sourceTrigger: HTMLButtonElement;
  private readonly sourceMenu: HTMLElement;
  private readonly selectedSource: HTMLElement;
  private readonly projectionSelect: HTMLSelectElement;
  private readonly analysisDebug: HTMLElement;
  private analysis: AudioAnalysis | null = null;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private ambientSeconds = 0;
  private manualSeconds = 0;
  private analysisPreviewTime = 0;
  private fieldSettingsKey = "";
  private lastAudibleVolume = 1;
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
  private screenPanPointerId: number | null = null;
  private screenPanButtonMask = 0;
  private lastScreenPanPoint: PlatePoint | null = null;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.renderShell();
    this.canvas = this.query<HTMLCanvasElement>(".wavefield-canvas");
    this.status = this.query<HTMLElement>(".status-text");
    this.playButton = this.query<HTMLButtonElement>(".play-toggle");
    this.volumeButton = this.query<HTMLButtonElement>(".volume-toggle");
    this.volumeSlider = this.query<HTMLInputElement>(".volume-slider");
    this.sourceTrigger = this.query<HTMLButtonElement>(".source-trigger");
    this.sourceMenu = this.query<HTMLElement>(".source-menu");
    this.selectedSource = this.query<HTMLElement>(".selected-source");
    this.projectionSelect = this.query<HTMLSelectElement>(".projection-mode-select");
    this.analysisDebug = this.query<HTMLElement>(".analysis-debug");

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

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
      this.query<HTMLElement>(".pane-host"),
      this.settings,
      () => this.handleSettingsChange(),
    );

    this.bindUi();
    this.syncHeaderControls();
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
    this.canvas.removeEventListener("contextmenu", this.handleCanvasContextMenu);
    document.removeEventListener("keydown", this.handleKeyDown);
    this.controls.dispose();
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
          <div class="brand">
            <span class="brand-mark"></span>
            <span>Wavefield</span>
          </div>
          <div class="source-picker">
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
          <label class="mode-picker">
            <i class="ph ph-sphere" aria-hidden="true"></i>
            <span>View</span>
            <select class="projection-mode-select" aria-label="Projection mode">
              <option value="screen" selected>Screen</option>
              <option value="sphere">Sphere</option>
            </select>
          </label>
        </section>
        <aside class="pane-host" aria-label="Wavefield shader settings"></aside>
        <section class="diagnostics-strip" aria-label="Wavefield diagnostics">
          <section class="analysis-debug" aria-label="Audio analysis debug" hidden></section>
          <div class="status-text" role="status">Choose a fixture or open an audio file.</div>
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
      if (!this.query<HTMLElement>(".source-picker").contains(event.target as Node)) {
        this.setSourceMenuOpen(false);
      }
    });

    this.projectionSelect.addEventListener("change", () => {
      this.settings.projectionMode = this.projectionSelect.value as CymaticSettings["projectionMode"];
      this.syncHeaderControls();
      this.setStatus(`Projection: ${this.projectionSelect.selectedOptions[0].text}`);
    });

    this.playButton.addEventListener("click", () => {
      this.togglePlayback();
    });

    this.volumeButton.addEventListener("click", () => {
      this.setMuted(!this.wavesurfer.getMuted());
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
    this.canvas.addEventListener("contextmenu", this.handleCanvasContextMenu);

    document.addEventListener("keydown", this.handleKeyDown);

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
    this.setPlayButton(false);
    this.resetVisualState();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.code !== "Space"
      || event.repeat
      || event.metaKey
      || event.ctrlKey
      || event.altKey
    ) {
      return;
    }
    if (isEditableKeyboardTarget(event.target)) {
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
      this.updateAnalysisDebug(fieldFrame, false);
    } else if (!this.analysis) {
      this.ambientSeconds += deltaSeconds;
      fieldFrame = createAmbientModalFieldFrame(this.ambientSeconds);
      renderDeltaSeconds = deltaSeconds;
      isIdlePreview = true;
      this.analysisDebug.hidden = true;
    } else if (isPlaying) {
      fieldFrame = this.modalEngine.update(time, this.settings, deltaSeconds);
      this.lastModalFieldFrame = fieldFrame;
      renderDeltaSeconds = deltaSeconds;
      this.updateAnalysisDebug(fieldFrame, false);
    } else {
      if (fieldFrame.modes.length === 0) {
        const previewTime = time > 0.05 ? time : this.analysisPreviewTime;
        fieldFrame = this.modalEngine.update(previewTime, this.settings, 1 / 60);
        this.lastModalFieldFrame = fieldFrame;
        this.updateAnalysisDebug(fieldFrame, false);
      }
    }

    this.updateScreenViewDamping(deltaSeconds);
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

  private resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.modalRenderer.setSize(this.canvas.width, this.canvas.height);
  };

  private query<T extends Element>(selector: string) {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing ${selector}`);
    }
    return element;
  }

  private setStatus(message: string) {
    this.status.textContent = message;
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
    void this.wavesurfer.playPause().catch((error: unknown) => {
      this.setStatus(
        error instanceof Error
          ? error.message
          : "Playback was blocked by the browser",
      );
    });
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

    const platePoint = this.getPlatePoint(event.clientX, event.clientY);
    this.screenViewTarget.scale = nextScale;
    this.screenViewTarget.offsetX =
      anchor.x - ((platePoint.x - 0.5) / nextScale + 0.5);
    this.screenViewTarget.offsetY =
      anchor.y - ((platePoint.y - 0.5) / nextScale + 0.5);
  };

  private handleCanvasPointerDown = (event: PointerEvent) => {
    if (
      this.settings.projectionMode !== "screen" ||
      (event.button !== 0 && event.button !== 2)
    ) {
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
    this.screenViewTarget.offsetX -=
      (nextPoint.x - this.lastScreenPanPoint.x) / this.screenViewTarget.scale;
    this.screenViewTarget.offsetY -=
      (nextPoint.y - this.lastScreenPanPoint.y) / this.screenViewTarget.scale;
    this.lastScreenPanPoint = nextPoint;
  };

  private handleCanvasPointerUp = (event: PointerEvent) => {
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

  private handleSettingsChange() {
    const nextFieldSettingsKey = getFieldSettingsKey(this.settings);
    if (nextFieldSettingsKey !== this.fieldSettingsKey) {
      this.fieldSettingsKey = nextFieldSettingsKey;
      if (this.settings.driveMode === "manual") {
        this.manualSeconds = 0;
        this.modalEngine.reset(0);
      } else {
        this.modalEngine.reset(this.wavesurfer.getCurrentTime());
      }
      this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
      this.resetVisualState();
    }
    this.setStatus("Settings updated");
    this.syncHeaderControls();
  }

  private syncHeaderControls() {
    this.projectionSelect.value = this.settings.projectionMode;
    this.controls.refresh();
  }

  private resetVisualState() {
    this.modalRenderer.requestReset();
  }

  private updateAnalysisDebug(fieldFrame: ModalFieldFrame, isIdlePreview: boolean) {
    if (!this.analysis && !isIdlePreview && this.settings.driveMode !== "manual") {
      this.analysisDebug.hidden = true;
      return;
    }

    const signals = fieldFrame.signals;
    this.analysisDebug.hidden = false;
    this.analysisDebug.innerHTML = `
      <div class="analysis-debug-row">
        <span>peaks</span>
        <strong>${fieldFrame.debug.peakSummary}</strong>
      </div>
      <div class="analysis-debug-row">
        <span>modes</span>
        <strong>${fieldFrame.modes.length}/${fieldFrame.debug.activeModeCount}</strong>
      </div>
      <div class="analysis-debug-meter">
        <span>S ${formatSignal(signals.structure)}</span>
        <span>E ${formatSignal(signals.energy)}</span>
        <span>C ${formatSignal(signals.change)}</span>
        <span>P ${formatSignal(signals.pulse)}</span>
      </div>
    `;
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

function formatSignal(value: number) {
  return Math.round(value * 100).toString().padStart(2, "0");
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
  return [
    settings.driveMode,
    settings.testFrequency,
    settings.frequencySweep,
    settings.frequencySweepRate,
  ].join(":");
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest("input, select, textarea, [contenteditable=''], [contenteditable='true']"),
  );
}

type PlatePoint = {
  x: number;
  y: number;
};
