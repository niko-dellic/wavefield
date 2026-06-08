import {
  loadJsonFromLocalStorage,
  saveJsonToLocalStorage,
} from "../storage.ts";

export type AudioOutputState = {
  volume: number;
  muted: boolean;
  lastAudibleVolume: number;
};

export const AUDIO_OUTPUT_STORAGE_KEY = "wavefield:audio-output";

export const DEFAULT_AUDIO_OUTPUT_STATE: AudioOutputState = {
  volume: 1,
  muted: false,
  lastAudibleVolume: 1,
};

export function loadAudioOutputState() {
  return loadJsonFromLocalStorage(
    AUDIO_OUTPUT_STORAGE_KEY,
    DEFAULT_AUDIO_OUTPUT_STATE,
    coerceAudioOutputState,
  );
}

export function saveAudioOutputState(state: AudioOutputState) {
  saveJsonToLocalStorage(
    AUDIO_OUTPUT_STORAGE_KEY,
    coerceAudioOutputState(state),
  );
}

export function coerceAudioOutputState(value: unknown): AudioOutputState {
  if (!isRecord(value)) {
    return { ...DEFAULT_AUDIO_OUTPUT_STATE };
  }

  const volume = clampFiniteNumber(
    value.volume,
    DEFAULT_AUDIO_OUTPUT_STATE.volume,
  );
  const lastAudibleVolume = clampAudibleVolume(
    value.lastAudibleVolume,
    volume > 0 ? volume : DEFAULT_AUDIO_OUTPUT_STATE.lastAudibleVolume,
  );
  const muted =
    typeof value.muted === "boolean" ? value.muted : volume <= 0;

  return {
    volume,
    muted: muted || volume <= 0,
    lastAudibleVolume,
  };
}

function clampFiniteNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

function clampAudibleVolume(value: unknown, fallback: number) {
  const clamped = clampFiniteNumber(value, fallback);
  return clamped > 0 ? clamped : DEFAULT_AUDIO_OUTPUT_STATE.lastAudibleVolume;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
