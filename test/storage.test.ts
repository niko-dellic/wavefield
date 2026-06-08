import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_OUTPUT_STORAGE_KEY,
  coerceAudioOutputState,
  loadAudioOutputState,
  saveAudioOutputState,
} from "../src/audio/audioOutputState.ts";
import {
  loadJsonFromLocalStorage,
  saveJsonToLocalStorage,
} from "../src/storage.ts";

test("storage helper loads coerced JSON and saves serialized values", () => {
  const store = createLocalStorage();
  setTestWindow(store);

  store.setItem("wavefield:test", JSON.stringify({ count: 3 }));

  const value = loadJsonFromLocalStorage(
    "wavefield:test",
    { count: 0 },
    (input) => {
      const count = (input as { count?: unknown }).count;
      return { count: typeof count === "number" ? count : 0 };
    },
  );

  assert.deepEqual(value, { count: 3 });

  saveJsonToLocalStorage("wavefield:saved", { enabled: true });
  assert.equal(store.getItem("wavefield:saved"), '{"enabled":true}');
});

test("storage helper falls back when stored JSON is invalid", () => {
  const store = createLocalStorage();
  setTestWindow(store);

  store.setItem("wavefield:test", "{not json");

  const value = loadJsonFromLocalStorage(
    "wavefield:test",
    { count: 7 },
    (input) => {
      const count = (input as { count?: unknown }).count;
      return { count: typeof count === "number" ? count : 0 };
    },
  );

  assert.deepEqual(value, { count: 7 });
});

test("audio output state loads, clamps, and saves persisted volume", () => {
  const store = createLocalStorage();
  setTestWindow(store);

  store.setItem(
    AUDIO_OUTPUT_STORAGE_KEY,
    JSON.stringify({
      volume: 1.4,
      muted: false,
      lastAudibleVolume: -2,
    }),
  );

  assert.deepEqual(loadAudioOutputState(), {
    volume: 1,
    muted: false,
    lastAudibleVolume: 1,
  });

  saveAudioOutputState({
    volume: 0.35,
    muted: true,
    lastAudibleVolume: 0.7,
  });
  assert.equal(
    store.getItem(AUDIO_OUTPUT_STORAGE_KEY),
    '{"volume":0.35,"muted":true,"lastAudibleVolume":0.7}',
  );
});

test("audio output state falls back when persisted JSON is invalid", () => {
  const store = createLocalStorage();
  setTestWindow(store);

  store.setItem(AUDIO_OUTPUT_STORAGE_KEY, "{not json");

  assert.deepEqual(loadAudioOutputState(), {
    volume: 1,
    muted: false,
    lastAudibleVolume: 1,
  });
});

test("audio output state treats zero volume as muted", () => {
  assert.deepEqual(
    coerceAudioOutputState({
      volume: 0,
      muted: false,
      lastAudibleVolume: 0.42,
    }),
    {
      volume: 0,
      muted: true,
      lastAudibleVolume: 0.42,
    },
  );
});

function setTestWindow(localStorage: Storage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

function createLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
