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
    // Base paths match the `servers` entry each contract declares for local
    // development (docker-compose maps the auth service to 3000, the Trade
    // REST API to 8080).
    provideAuthApi({ basePath: 'http://localhost:3000' }),
    provideTradeApi({ basePath: 'http://localhost:8080' })
  ]
};
