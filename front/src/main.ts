import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Needed by the currency/number pipes that format with 'es-ES'.
registerLocaleData(localeEs, 'es-ES');

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
