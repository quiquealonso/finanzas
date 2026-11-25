import { Routes } from '@angular/router';
import { sessionUser } from './core/session';

/**
 * Every page of the app: its URL (/resumen, /perfil-riesgo…), the sidebar entry and the component, loaded only
 * when the page is opened (lazy loading). Order = order in the sidebar. A new page is one line here.
 */
export type PageDef = {
  path: string;
  label: string;
  /** SVG path of the sidebar icon (24×24). */
  icon: string;
  load: () => Promise<unknown>;
};

export const PAGES: PageDef[] = [
  { path: 'resumen', label: 'Resumen', icon: 'M3 17l5-5 4 4 8-8M14 8h6v6',
    load: () => import('./features/overview/overview-page.component').then((m) => m.OverviewPageComponent) },
  { path: 'activos', label: 'Activos', icon: 'M3 7h18v12H3zM3 7l2-3h14l2 3M8 12h8',
    load: () => import('./features/holdings/holdings-page.component').then((m) => m.HoldingsPageComponent) },
  { path: 'calendario', label: 'Calendario', icon: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2',
    load: () => import('./features/calendar/calendar-page.component').then((m) => m.CalendarPageComponent) },
  { path: 'mensual', label: 'Mensual', icon: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16',
    load: () => import('./features/monthly/monthly-page.component').then((m) => m.MonthlyPageComponent) },
  { path: 'distribucion', label: 'Distribución', icon: 'M12 3a9 9 0 109 9h-9zM15 3.5A9 9 0 0120.5 9H15z',
    load: () => import('./features/charts/charts-page.component').then((m) => m.ChartsPageComponent) },
  { path: 'composicion', label: 'Composición', icon: 'M12 3a9 9 0 109 9M12 7a5 5 0 105 5h-5zM12 3v4M21 12h-4',
    load: () => import('./features/composition/composition-page.component').then((m) => m.CompositionPageComponent) },
  { path: 'comparar', label: 'Comparar', icon: 'M3 20h18M5 16l4-5 3 3 4-6 3 3M5 9l4-3 3 2 6-4',
    load: () => import('./features/compare/compare-page.component').then((m) => m.ComparePageComponent) },
  { path: 'movimientos', label: 'Movimientos', icon: 'M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4',
    load: () => import('./features/movements/movements-page.component').then((m) => m.MovementsPageComponent) },
  { path: 'ventas', label: 'Ventas', icon: 'M4 19h16M7 15l4-4 3 3 5-6M15 8h4v4',
    load: () => import('./features/realized/realized-page.component').then((m) => m.RealizedPageComponent) },
  { path: 'inmobiliario', label: 'Inmobiliario', icon: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6',
    load: () => import('./features/real-estate/real-estate-page.component').then((m) => m.RealEstatePageComponent) },
  { path: 'cierres', label: 'Cierres', icon: 'M4 4h16v16H4zM4 9h16M9 9v11M14 9v11M6.5 6.5h0',
    load: () => import('./features/closings/closings-page.component').then((m) => m.ClosingsPageComponent) },
  { path: 'objetivos', label: 'Objetivos', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h0',
    load: () => import('./features/goals/goals-page.component').then((m) => m.GoalsPageComponent) },
  { path: 'simulador', label: 'Simulador', icon: 'M5 3h14v18H5zM8 7h8M8 11h2M12 11h2M16 11v6M8 14h2M12 14h2M8 17h2M12 17h2',
    load: () => import('./features/simulator/simulator-page.component').then((m) => m.SimulatorPageComponent) },
  { path: 'perfil-riesgo', label: 'Perfil de riesgo', icon: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4',
    load: () => import('./features/risk-profile/risk-profile-page.component').then((m) => m.RiskProfilePageComponent) },
  { path: 'noticias', label: 'Noticias', icon: 'M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M7 9h7M7 13h7M7 16h4',
    load: () => import('./features/news/news-page.component').then((m) => m.NewsPageComponent) },
  { path: 'sentimiento', label: 'Sentimiento', icon: 'M4 16a8 8 0 1116 0M12 16l4-5M7 20h10',
    load: () => import('./features/sentiment/sentiment-page.component').then((m) => m.SentimentPageComponent) },
  { path: 'valoraciones', label: 'Valoraciones', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    load: () => import('./features/valuations/valuations-page.component').then((m) => m.ValuationsPageComponent) },
  { path: 'formula-magica', label: 'Fórmula mágica', icon: 'M4 20l10-10M14 10l2-2 2 2-2 2zM17 3v3M20 6h-3M6 4v2M7 5H5M19 15v2M20 16h-2',
    load: () => import('./features/magic-formula/magic-formula-page.component').then((m) => m.MagicFormulaPageComponent) },
  { path: 'apuestas', label: 'Apuestas', icon: 'M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4zM10 6v12',
    load: () => import('./features/betting/betting-page.component').then((m) => m.BettingPageComponent) },
];

/** Pages each user does not see (not in the sidebar and the URL does not open them). user2 is used in class. */
export const HIDDEN_FOR: Record<string, string[]> = { user2: ['apuestas', 'formula-magica'], demo: ['apuestas'] };

export const isVisible = (path: string): boolean => !HIDDEN_FOR[sessionUser() ?? '']?.includes(path);

/** Last page opened, to come back to it on the next visit (key kept from before the router). */
export const LAST_PAGE_KEY = 'finanzas.page';
/** Old page ids (before the router) → URL, so a remembered page still works. */
const OLD_IDS: Record<string, string> = {
  overview: 'resumen', holdings: 'activos', calendar: 'calendario', monthly: 'mensual', charts: 'distribucion',
  composition: 'composicion', movements: 'movimientos', realized: 'ventas', realestate: 'inmobiliario', closings: 'cierres',
  goals: 'objetivos', risk: 'perfil-riesgo', news: 'noticias', sentiment: 'sentimiento', valuations: 'valoraciones',
  magic: 'formula-magica', betting: 'apuestas',
};

function lastPage(): string {
  try {
    const saved = localStorage.getItem(LAST_PAGE_KEY) ?? '';
    const path = OLD_IDS[saved] ?? saved;
    if (PAGES.some((p) => p.path === path) && isVisible(path)) return path;
  } catch {
    /* storage blocked */
  }
  return 'resumen';
}

export const routes: Routes = [
  // "/" opens the last page used.
  { path: '', pathMatch: 'full', redirectTo: () => lastPage() },
  ...PAGES.map((p) => ({
    path: p.path,
    title: `${p.label} · Finanzas`,
    loadComponent: p.load as () => Promise<any>,
    // Hidden pages do not match: the URL falls to "**" and goes to Resumen.
    canMatch: [() => isVisible(p.path)],
  })),
  { path: '**', redirectTo: 'resumen' },
];
