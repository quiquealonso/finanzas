/**
 * Where the back end is. Local development: the back on this computer. The published app (GitHub Pages, /app/) is
 * built with this file rewritten by .github/workflows/pages.yml: API_ORIGIN = the server (repository variable
 * API_URL) and DEMO_ONLY = false. The demo build keeps DEMO_ONLY = null: on github.io it only runs the demo.
 */
export const API_ORIGIN = 'http://localhost:3000';
/** true/false forces it; null = demo only when published on github.io (see demo/demo-mode.ts). */
export const DEMO_ONLY: boolean | null = null;
