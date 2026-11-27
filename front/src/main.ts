import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// GitHub Pages has no URL rewriting: its 404.html (written by .github/workflows/pages.yml) keeps the address asked
// for and sends here; put it back so a reload on /finanzas/app/resumen opens that page.
try {
  const asked = sessionStorage.getItem('finanzas.redirect');
  sessionStorage.removeItem('finanzas.redirect');
  if (asked && asked.startsWith(new URL(document.baseURI).pathname)) history.replaceState(null, '', asked);
} catch {
  /* storage blocked: the app opens on its first page */
}

// Needed by the currency/number pipes that format with 'es-ES'.
registerLocaleData(localeEs, 'es-ES');

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
