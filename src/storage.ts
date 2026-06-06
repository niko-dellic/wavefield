export function loadJsonFromLocalStorage<T>(
  key: string,
  fallback: T,
  coerce: (value: unknown) => T,
) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return coerce(rawValue ? JSON.parse(rawValue) : fallback);
  } catch {
    return coerce(fallback);
  }
}

export function saveJsonToLocalStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is a convenience; storage failures should not break
    // rendering or controls.
  }
}
