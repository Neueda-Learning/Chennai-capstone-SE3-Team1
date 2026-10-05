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
    provideHttpClient(withInterceptors([bearerInterceptor])),
    provideAuthApi({ basePath: 'http://localhost:3000' }),
    provideTradeApi({ basePath: 'http://localhost:8081' })
  ]
};
