import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { bearerInterceptor } from './core/auth/bearer.interceptor';
import { credentialCryptoInterceptor } from './core/auth/credential-crypto.interceptor';
import { provideApi as provideAuthApi } from './generated/auth-client';
import { provideApi as provideTradeApi } from './generated/trade-client';
import { RUNTIME_CONFIG, RuntimeConfig } from './core/config/runtime-config';

/** The app's providers, with the service addresses from the runtime config (see runtime-config.ts). */
export function buildAppConfig(config: RuntimeConfig): ApplicationConfig {
  return {
    providers: [
      { provide: RUNTIME_CONFIG, useValue: config },
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes),
      provideHttpClient(withInterceptors([bearerInterceptor, credentialCryptoInterceptor])),
      provideAuthApi({ basePath: config.authApiUrl }),
      provideTradeApi({ basePath: config.tradeApiUrl })
    ]
  };
}
