import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { bearerInterceptor } from './core/auth/bearer.interceptor';
import { provideApi as provideAuthApi } from './generated/auth-client';
import { provideApi as provideTradeApi } from './generated/trade-client';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // The bearer interceptor attaches the session's access token to every call
    // except the three publicly registered auth endpoints.
    provideHttpClient(withInterceptors([bearerInterceptor])),
    // Base paths match the ports the local non-Docker stack actually binds.
    // `run-local.ps1` starts the Trade REST API on 8081 ($ApiPort), and the
    // auth service on 3000. The contract's `servers` entry says 8080, but that
    // is the port inside the docker-compose trade-api container, not the one
    // run-local.ps1 publishes on the host.
    provideAuthApi({ basePath: 'http://localhost:3000' }),
    provideTradeApi({ basePath: 'http://localhost:8081' })
  ]
};
