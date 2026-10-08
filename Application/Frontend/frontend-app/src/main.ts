import 'bootstrap/dist/js/bootstrap.bundle.min.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { buildAppConfig } from './app/app.config';
import { App } from './app/app';
import { loadRuntimeConfig } from './app/core/config/runtime-config';

// The service addresses are loaded first (public/config.json, written from Application/Config/services.env).
loadRuntimeConfig()
  .then((config) => bootstrapApplication(App, buildAppConfig(config)))
  .catch((err) => {
    console.error(err);
    const notice = document.createElement('pre');
    notice.textContent = `The app could not start.

${err instanceof Error ? err.message : String(err)}`;
    document.body.replaceChildren(notice);
  });
