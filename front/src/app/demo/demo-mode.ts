/**
 * Demo mode: the app runs with the fictitious portfolio of the "demo" user, saved in public/demo/*.json
 * (back/scripts/demo-fixtures.js), without a back end. demo.interceptor.ts answers every API call from those files;
 * changes stay in this browser tab and are not saved anywhere. The guided tour (tour.service.ts) starts on entry.
 *
 * On: "Probar la demo guiada" on the login screen (flag in localStorage), or always on GitHub Pages (no back end there).
 */
import { DEMO_ONLY } from '../core/api-origin';

const KEY = 'finanzas.demo';
/** Things the demo remembers between reloads (risk profile, saved funds, tour progress). */
export const DEMO_STATE_KEY = 'finanzas.demo.state';

/**
 * Only the demo can work: the demo build published on GitHub Pages (no back end there). The real app published at
 * /app/ is built with DEMO_ONLY = false (core/api-origin.ts, written by .github/workflows/pages.yml).
 */
export const STATIC_SITE = DEMO_ONLY ?? (typeof location !== 'undefined' && location.hostname.endsWith('github.io'));

export function isDemo(): boolean {
  if (STATIC_SITE) return true;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Enters the demo from the login screen, with the tour from the start. */
export function enterDemo(): void {
  try {
    localStorage.setItem(KEY, '1');
    localStorage.removeItem(DEMO_STATE_KEY);
  } catch {
    /* storage blocked: the demo cannot start */
  }
  location.href = document.baseURI;
}

/** Leaves the demo (back to the login screen). On the static site it starts the demo again instead. */
export function leaveDemo(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DEMO_STATE_KEY);
  } catch {
    /* ignore */
  }
  location.href = document.baseURI;
}

/** Small persisted state of the demo (JSON in localStorage). */
export function demoState<T>(key: string, fallback: T): T {
  try {
    const all = JSON.parse(localStorage.getItem(DEMO_STATE_KEY) ?? '{}');
    return key in all ? (all[key] as T) : fallback;
  } catch {
    return fallback;
  }
}

export function setDemoState(key: string, value: unknown): void {
  try {
    const all = JSON.parse(localStorage.getItem(DEMO_STATE_KEY) ?? '{}');
    all[key] = value;
    localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: it lasts until the reload */
  }
}
