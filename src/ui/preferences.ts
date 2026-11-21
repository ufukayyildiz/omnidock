export const DEFAULT_REFRESH_INTERVAL_SECONDS = 10;

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Preferences stay in React state when browser storage is unavailable.
  }
}

export function parseRefreshInterval(value: string | null): number {
  if (value === null || value.trim() === "") return DEFAULT_REFRESH_INTERVAL_SECONDS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_REFRESH_INTERVAL_SECONDS;
  return Math.min(300, Math.round(seconds));
}
