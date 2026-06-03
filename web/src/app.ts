import * as THREE from "three";
import WaveSurfer from "wavesurfer.js";

import {
  EMPTY_MODAL_FIELD_FRAME,
  ModalFieldEngine,
  createAmbientModalFieldFrame,
  type ModalFieldFrame,
} from "./audio/ModalField";
import { decodeAndAnalyzeAudio } from "./audio/analyze";
import { PulseScheduler } from "./audio/PulseScheduler";
import { createControls, type ControlsManager } from "./ui/controls";
import { CymaticPulseRenderer } from "./webgl/CymaticPulseRenderer";
import { ModalFieldRenderer } from "./webgl/ModalFieldRenderer";
import {
  BAND_COLORS,
  DEFAULT_SETTINGS,
  type AudioAnalysis,
  type CymaticSettings,
  type FrequencyBand,
  type OriginMode,
  type PulseBurst,
} from "./types";

const FIXTURES = [
  {
    label: "Music For",
    url: "/fixtures/audio/music%20for%20inst%20mix%20ab%20oz.mp3",
  },
  {
    label: "Contradictions",
    url: "/fixtures/audio/contradictions%20inst%20mix%20ab%20oz.mp3",
  },
];

export class WavefieldApp {
  private readonly settings: CymaticSettings = { ...DEFAULT_SETTINGS };
  private readonly scheduler = new PulseScheduler();
  private readonly modalEngine = new ModalFieldEngine();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly burstRenderer = new CymaticPulseRenderer();
  private readonly modalRenderer = new ModalFieldRenderer();
  private readonly wavesurfer: WaveSurfer;
  private readonly controls: ControlsManager;
  private readonly canvas: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly sourceTrigger: HTMLButtonElement;
  private readonly sourceMenu: HTMLElement;
  private readonly selectedSource: HTMLElement;
  private readonly simulationSelect: HTMLSelectElement;
  private readonly projectionSelect: HTMLSelectElement;
  private readonly originModeSelect: HTMLSelectElement;
  private analysis: AudioAnalysis | null = null;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private pendingBursts: PulseBurst[] = [];
  private ambientSeconds = 0;
  private lastModalFieldFrame: ModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
  private previousSimulationMode: CymaticSettings["simulationMode"] =
    this.settings.simulationMode;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.renderShell();
    this.canvas = this.query<HTMLCanvasElement>(".wavefield-canvas");
    this.status = this.query<HTMLElement>(".status-text");
    this.playButton = this.query<HTMLButtonElement>(".play-toggle");
    this.sourceTrigger = this.query<HTMLButtonElement>(".source-trigger");
    this.sourceMenu = this.query<HTMLElement>(".source-menu");
    this.selectedSource = this.query<HTMLElement>(".selected-source");
    this.simulationSelect = this.query<HTMLSelectElement>(".simulation-mode-select");
    this.projectionSelect = this.query<HTMLSelectElement>(".projection-mode-select");
    this.originModeSelect = this.query<HTMLSelectElement>(".origin-mode-select");

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
    this.resize();
  }

  start() {
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    this.controls.dispose();
    this.burstRenderer.dispose();
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
            <i class="ph ph-sliders-horizontal" aria-hidden="true"></i>
            <span>Sim</span>
            <select class="simulation-mode-select" aria-label="Simulation mode">
              <option value="modal" selected>Modal</option>
              <option value="bursts">Bursts</option>
              <option value="wave" disabled>Wave soon</option>
            </select>
          </label>
          <label class="mode-picker">
            <i class="ph ph-sphere" aria-hidden="true"></i>
            <span>View</span>
            <select class="projection-mode-select" aria-label="Projection mode">
              <option value="screen" selected>Screen</option>
              <option value="sphere">Sphere</option>
            </select>
          </label>
          <label class="mode-picker">
            <i class="ph ph-waveform" aria-hidden="true"></i>
            <span>Origin</span>
            <select class="origin-mode-select" aria-label="Origin mode">
              <option value="mono" selected>Mono</option>
              <option value="split">Split</option>
            </select>
          </label>
        </section>
        <aside class="pane-host" aria-label="Wavefield shader settings"></aside>
        <section class="transport" aria-label="Audio transport">
          <button class="play-toggle" type="button">
            <i class="ph ph-play" aria-hidden="true"></i>
            <span>Play</span>
          </button>
          <div class="waveform"></div>
          <p class="status-text">Choose a fixture or open an audio file.</p>
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

    this.simulationSelect.addEventListener("change", () => {
      this.settings.simulationMode = this.simulationSelect.value as CymaticSettings["simulationMode"];
      if (this.settings.simulationMode === "bursts") {
        this.settings.projectionMode = "screen";
      }
      this.previousSimulationMode = this.settings.simulationMode;
      this.pendingBursts =
        this.settings.simulationMode === "bursts"
          ? createPreviewBursts(this.settings)
          : [];
      this.resetVisualState();
      this.syncHeaderControls();
      this.setStatus(`Simulation: ${this.simulationSelect.selectedOptions[0].text}`);
    });

    this.projectionSelect.addEventListener("change", () => {
      this.settings.projectionMode = this.projectionSelect.value as CymaticSettings["projectionMode"];
      this.syncHeaderControls();
      this.setStatus(`Projection: ${this.projectionSelect.selectedOptions[0].text}`);
    });

    this.originModeSelect.addEventListener("change", () => {
      this.settings.originMode = this.originModeSelect.value as OriginMode;
      this.pendingBursts = createPreviewBursts(this.settings);
      this.resetVisualState();
      this.syncHeaderControls();
      this.setStatus(`Origin mode: ${this.originModeSelect.selectedOptions[0].text}`);
    });

    this.playButton.addEventListener("click", () => {
      void this.wavesurfer.playPause().catch((error: unknown) => {
        this.setStatus(
          error instanceof Error
            ? error.message
            : "Playback was blocked by the browser",
        );
      });
    });

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
      this.scheduler.reset(this.wavesurfer.getCurrentTime());
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
      this.scheduler.reset(time);
      this.modalEngine.reset(time);
      this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
      this.resetVisualState();
    });
    this.wavesurfer.on("interaction", () => {
      const time = this.wavesurfer.getCurrentTime();
      this.scheduler.reset(time);
      this.modalEngine.reset(time);
    });
    this.wavesurfer.on("error", (error) => {
      this.setStatus(error instanceof Error ? error.message : String(error));
    });
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
    this.scheduler.setAnalysis(analysis);
    this.modalEngine.setAnalysis(analysis);
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.pendingBursts = createPreviewBursts(this.settings);
    this.resetVisualState();
  }

  private prepareForNewAudio() {
    this.analysis = null;
    this.scheduler.setAnalysis(null);
    this.modalEngine.setAnalysis(null);
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.ambientSeconds = 0;
    this.setPlayButton(false);
    this.resetVisualState();
  }

  private animate = (now: number) => {
    const deltaSeconds = Math.min(0.1, (now - this.lastFrameTime) / 1_000);
    this.lastFrameTime = now;
    const time = this.wavesurfer.getCurrentTime();
    const isPlaying = this.wavesurfer.isPlaying();
    if (this.settings.simulationMode === "bursts") {
      const scheduledBursts = isPlaying
        ? this.scheduler.collect(time, this.settings)
        : [];
      const bursts = this.pendingBursts.length
        ? [...this.pendingBursts, ...scheduledBursts].slice(-12)
        : scheduledBursts;
      this.pendingBursts = [];
      this.burstRenderer.render(
        this.renderer,
        bursts,
        this.settings,
        isPlaying ? deltaSeconds : 0,
      );
    } else {
      let fieldFrame = this.lastModalFieldFrame;
      let renderDeltaSeconds = 0;
      let isIdlePreview = false;

      if (!this.analysis) {
        this.ambientSeconds += deltaSeconds;
        fieldFrame = createAmbientModalFieldFrame(this.ambientSeconds);
        renderDeltaSeconds = deltaSeconds;
        isIdlePreview = true;
      } else if (isPlaying) {
        fieldFrame = this.modalEngine.update(time, this.settings, deltaSeconds);
        this.lastModalFieldFrame = fieldFrame;
        renderDeltaSeconds = deltaSeconds;
      }

      this.pendingBursts = [];
      this.modalRenderer.render(
        this.renderer,
        fieldFrame,
        this.settings,
        renderDeltaSeconds,
        isIdlePreview,
      );
    }

    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.burstRenderer.setSize(this.canvas.width, this.canvas.height);
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
    this.playButton.innerHTML = `
      <i class="ph ${isPlaying ? "ph-pause" : "ph-play"}" aria-hidden="true"></i>
      <span>${isPlaying ? "Pause" : "Play"}</span>
    `;
  }

  private handleSettingsChange() {
    if (this.settings.simulationMode === "wave") {
      this.settings.simulationMode = "modal";
      this.setStatus("Wave solver is coming soon");
    } else if (this.settings.simulationMode === "bursts") {
      this.settings.projectionMode = "screen";
      this.setStatus("Settings updated");
    } else {
      this.setStatus("Settings updated");
    }

    if (this.settings.simulationMode !== this.previousSimulationMode) {
      this.previousSimulationMode = this.settings.simulationMode;
      this.pendingBursts =
        this.settings.simulationMode === "bursts"
          ? createPreviewBursts(this.settings)
          : [];
      this.resetVisualState();
    }

    this.syncHeaderControls();
  }

  private syncHeaderControls() {
    this.simulationSelect.value = this.settings.simulationMode;
    this.projectionSelect.value = this.settings.projectionMode;
    this.projectionSelect.disabled = this.settings.simulationMode !== "modal";
    this.originModeSelect.value = this.settings.originMode;
    this.controls.refresh();
  }

  private resetVisualState() {
    this.burstRenderer.requestReset();
    this.modalRenderer.requestReset();
  }
}

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function createPreviewBursts(settings: CymaticSettings): PulseBurst[] {
  if (settings.originMode === "mono") {
    return [
      {
        centerUv: [0.5, 0.5],
        reachRadius: 0.58,
        edgeRadius: 0.05,
        intensity: 0.64,
        phaseSeed: 0.33,
        color: BAND_COLORS.mid,
      },
    ];
  }

  const bands: Array<[FrequencyBand, number]> = [
    ["low", -1],
    ["mid", 0],
    ["high", 1],
  ];

  return bands.map(([band, offset], index) => ({
    centerUv: [0.5 + offset * settings.sourceSpread, 0.5],
    reachRadius: 0.46 + index * 0.08,
    edgeRadius: 0.05,
    intensity: 0.58,
    phaseSeed: 0.18 + index * 0.27,
    color: BAND_COLORS[band],
  }));
}
