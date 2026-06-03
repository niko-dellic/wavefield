import * as THREE from "three";
import WaveSurfer from "wavesurfer.js";

import {
  EMPTY_MODAL_FIELD_FRAME,
  ModalFieldEngine,
  createAmbientModalFieldFrame,
  type ModalFieldFrame,
} from "./audio/ModalField";
import { decodeAndAnalyzeAudio } from "./audio/analyze";
import contradictionsUrl from "./fixtures/audio/contradictions inst mix ab oz.mp3";
import musicForUrl from "./fixtures/audio/music for inst mix ab oz.mp3";
import { createControls, type ControlsManager } from "./ui/controls";
import { ModalFieldRenderer } from "./webgl/ModalFieldRenderer";
import { DEFAULT_SETTINGS, type AudioAnalysis, type CymaticSettings } from "./types";

const FIXTURES = [
  {
    label: "Music For",
    url: musicForUrl,
  },
  {
    label: "Contradictions",
    url: contradictionsUrl,
  },
];

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
  private readonly sourceTrigger: HTMLButtonElement;
  private readonly sourceMenu: HTMLElement;
  private readonly selectedSource: HTMLElement;
  private readonly projectionSelect: HTMLSelectElement;
  private analysis: AudioAnalysis | null = null;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private ambientSeconds = 0;
  private lastModalFieldFrame: ModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.renderShell();
    this.canvas = this.query<HTMLCanvasElement>(".wavefield-canvas");
    this.status = this.query<HTMLElement>(".status-text");
    this.playButton = this.query<HTMLButtonElement>(".play-toggle");
    this.sourceTrigger = this.query<HTMLButtonElement>(".source-trigger");
    this.sourceMenu = this.query<HTMLElement>(".source-menu");
    this.selectedSource = this.query<HTMLElement>(".selected-source");
    this.projectionSelect = this.query<HTMLSelectElement>(".projection-mode-select");

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

    this.projectionSelect.addEventListener("change", () => {
      this.settings.projectionMode = this.projectionSelect.value as CymaticSettings["projectionMode"];
      this.syncHeaderControls();
      this.setStatus(`Projection: ${this.projectionSelect.selectedOptions[0].text}`);
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
    this.modalEngine.setAnalysis(analysis);
    this.lastModalFieldFrame = EMPTY_MODAL_FIELD_FRAME;
    this.resetVisualState();
  }

  private prepareForNewAudio() {
    this.analysis = null;
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

    this.modalRenderer.render(
      this.renderer,
      fieldFrame,
      this.settings,
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
    this.playButton.innerHTML = `
      <i class="ph ${isPlaying ? "ph-pause" : "ph-play"}" aria-hidden="true"></i>
      <span>${isPlaying ? "Pause" : "Play"}</span>
    `;
  }

  private handleSettingsChange() {
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
}

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}
