import {
  HttpBackend,
  HttpClient,
  HttpEvent,
  HttpInterceptorFn,
  HttpResponse
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';

import {
  CryptoParams,
  isResponseEnvelope,
  openResponse,
  sealRequest
} from './credential-envelope';

/** Every POST the auth service takes, e.g. http://host:3000/auth/login. */
const AUTH_POST = /^(.*\/auth)\/(?!crypto-params$)[a-z-]+$/;

/**
 * Sends every POST to the auth service as an encrypted envelope and opens the encrypted reply,
 * so passwords, one-time codes and tokens do not cross a plain-HTTP network in the clear. It sits
 * after bearerInterceptor in the chain, so a retry after a token refresh is encrypted again with
 * a fresh nonce (each nonce works once).
 */
export const credentialCryptoInterceptor: HttpInterceptorFn = (request, next) => {
  const match = request.method === 'POST' ? AUTH_POST.exec(request.url.split('?')[0]) : null;
  if (match === null) {
    return next(request);
  }

  // The params request goes straight to the backend: it must not pass through this interceptor.
  const bare = new HttpClient(inject(HttpBackend));

  return bare.get<CryptoParams>(`${match[1]}/crypto-params`).pipe(
    switchMap((params): Observable<HttpEvent<unknown>> => {
      const sealed = sealRequest(params, request.body);
      return next(request.clone({ body: sealed.envelope })).pipe(
        map((event) =>
          event instanceof HttpResponse && isResponseEnvelope(event.body)
            ? event.clone({ body: openResponse(sealed, event.body) })
            : event
        )
      );
    })
  );
};
