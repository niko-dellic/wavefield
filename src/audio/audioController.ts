import WaveSurfer from "wavesurfer.js";

import { decodeAndAnalyzeAudio } from "./analyze";
import type { AudioAnalysis } from "../types";
import type { ShellElements } from "../ui/shellElements";
import type { ShellFixture } from "../ui/shell";

export type AudioControllerOptions = {
  root: HTMLElement;
  ui: Pick<
    ShellElements,
    | "audioFileInput"
    | "fixtureButtons"
    | "playButton"
    | "selectedSource"
    | "sourceMenu"
    | "sourcePicker"
    | "sourceTrigger"
    | "uploadButton"
    | "volumeButton"
    | "volumeSlider"
    | "waveform"
  >;
  fixtures: ShellFixture[];
  canTogglePlayback: () => boolean;
  onAnalysis: (analysis: AudioAnalysis) => void;
  onInteractionReset: (time: number) => void;
  onPrepareForNewAudio: () => void;
  onSeekReset: (time: number) => void;
  onStatus: (message: string) => void;
};

export class AudioController {
  readonly wavesurfer: WaveSurfer;

  private readonly disposers: Array<() => void> = [];
  private lastAudibleVolume = 1;

  constructor(private readonly options: AudioControllerOptions) {
    this.wavesurfer = WaveSurfer.create({
      container: options.ui.waveform,
      height: 62,
      normalize: true,
      waveColor: "#29313a",
      progressColor: "#d9f7ff",
      cursorColor: "#ffffff",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });
  }

  bind() {
    const { root, ui } = this.options;

    this.addEventListener(ui.sourceTrigger, "click", () => {
      this.setSourceMenuOpen(ui.sourceMenu.hasAttribute("hidden"));
    });
    this.addDocumentListener("click", (event) => {
      if (!ui.sourcePicker.contains(event.target as Node)) {
        this.setSourceMenuOpen(false);
      }
    });
    this.addEventListener(ui.playButton, "click", () => {
      if (this.options.canTogglePlayback()) {
        void this.togglePlayback();
      }
    });
    this.addEventListener(ui.volumeButton, "click", () => {
      this.setMuted(!this.wavesurfer.getMuted());
    });
    this.addEventListener(ui.volumeSlider, "input", () => {
      this.setVolume(Number(ui.volumeSlider.value));
    });
    for (const button of ui.fixtureButtons) {
      this.addEventListener(button, "click", () => {
        const fixtureUrl = button.dataset.fixtureUrl;
        if (fixtureUrl) {
          this.setSourceMenuOpen(false);
          void this.loadFixture(
            fixtureUrl,
            button.textContent?.trim() ?? "fixture",
          );
        }
      });
    }
    this.addEventListener(ui.uploadButton, "click", () => {
      this.setSourceMenuOpen(false);
      ui.audioFileInput.click();
    });
    this.addEventListener(ui.audioFileInput, "change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (file) {
        void this.loadFile(file);
      }
      input.value = "";
    });
    this.addEventListener(root, "dragover", (event) => {
      event.preventDefault();
      root.classList.add("is-dragging");
    });
    this.addEventListener(root, "dragleave", () => {
      root.classList.remove("is-dragging");
    });
    this.addEventListener(root, "drop", (event) => {
      event.preventDefault();
      root.classList.remove("is-dragging");
      const file = event.dataTransfer?.files[0];
      if (file?.type.startsWith("audio/")) {
        void this.loadFile(file);
      }
    });

    this.disposers.push(
      this.wavesurfer.on("ready", () => {
        this.options.onStatus("Audio ready");
      }),
      this.wavesurfer.on("play", () => {
        this.setPlayButton(true);
      }),
      this.wavesurfer.on("pause", () => {
        this.setPlayButton(false);
      }),
      this.wavesurfer.on("finish", () => {
        this.setPlayButton(false);
      }),
      this.wavesurfer.on("seeking", (time) => {
        this.options.onSeekReset(time);
      }),
      this.wavesurfer.on("interaction", () => {
        this.options.onInteractionReset(this.wavesurfer.getCurrentTime());
      }),
      this.wavesurfer.on("error", (error) => {
        this.options.onStatus(
          error instanceof Error ? error.message : String(error),
        );
      }),
    );

    this.syncVolumeControl();
  }

  async loadDefaultFixture() {
    const defaultFixture = this.options.fixtures[0];
    if (!defaultFixture) {
      return;
    }

    try {
      await this.loadFixture(defaultFixture.url, defaultFixture.label);
    } catch (error) {
      this.options.onStatus(
        error instanceof Error
          ? error.message
          : "Could not load the default fixture",
      );
    }
  }

  async loadFixture(url: string, label: string) {
    this.options.onStatus(`Loading ${label}...`);
    this.updateSelectedSource(label);
    this.options.onPrepareForNewAudio();

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

    this.options.onAnalysis(analysis);
    this.options.onStatus(
      `${label} analyzed: ${analysis.frames.length} frames`,
    );
  }

  async loadFile(file: File) {
    this.options.onStatus(`Loading ${file.name}...`);
    this.updateSelectedSource(file.name);
    this.options.onPrepareForNewAudio();

    const analysisPromise = file
      .arrayBuffer()
      .then((buffer) => decodeAndAnalyzeAudio(buffer));
    const wavePromise = this.wavesurfer.loadBlob(file);
    const [analysis] = await Promise.all([analysisPromise, wavePromise]);

    this.options.onAnalysis(analysis);
    this.options.onStatus(
      `${file.name} analyzed: ${analysis.frames.length} frames`,
    );
  }

  getCurrentTime() {
    return this.wavesurfer.getCurrentTime();
  }

  isPlaying() {
    return this.wavesurfer.isPlaying();
  }

  pause() {
    this.wavesurfer.pause();
    this.setPlayButton(false);
  }

  setPlayButton(isPlaying: boolean) {
    const label = isPlaying ? "Pause" : "Play";
    this.options.ui.playButton.innerHTML = `
      <i class="ph ${isPlaying ? "ph-pause" : "ph-play"}" aria-hidden="true"></i>
    `;
    this.options.ui.playButton.setAttribute("aria-label", label);
    this.options.ui.playButton.title = label;
  }

  togglePlayback() {
    return this.wavesurfer.playPause().catch((error: unknown) => {
      this.options.onStatus(
        error instanceof Error
          ? error.message
          : "Playback was blocked by the browser",
      );
    });
  }

  setVolume(volume: number) {
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

  setMuted(isMuted: boolean) {
    if (!isMuted && this.wavesurfer.getVolume() <= 0) {
      this.wavesurfer.setVolume(this.lastAudibleVolume);
    }
    this.wavesurfer.setMuted(isMuted);
    this.syncVolumeControl();
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.wavesurfer.destroy();
  }

  private setSourceMenuOpen(isOpen: boolean) {
    this.options.ui.sourceMenu.hidden = !isOpen;
    this.options.ui.sourceTrigger.setAttribute("aria-expanded", String(isOpen));
  }

  private updateSelectedSource(label: string) {
    this.options.ui.selectedSource.textContent = label;
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

    this.options.ui.volumeSlider.value = String(effectiveVolume);
    this.options.ui.volumeButton.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
    this.options.ui.volumeButton.setAttribute("aria-label", label);
    this.options.ui.volumeButton.title = label;
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

  private addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ) {
    document.addEventListener(type, listener);
    this.disposers.push(() => {
      document.removeEventListener(type, listener);
    });
  }
}
