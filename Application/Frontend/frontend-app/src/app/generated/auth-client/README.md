# @trading-ui/auth-api-client@1.0.0

Binding contract for the NestJS auth service built in Sprint 8. The Trade REST API and Angular UI must depend on this contract rather than on implementation details.  ## JWT claims contract  This section is normative. A token that does not carry exactly these claims breaks the Trade REST API\'s authorisation check.  | Claim | Type | Meaning | |---|---|---| | `sub` | string | The user identifier. A UUID. Stable for the life of the user. Not the username, not the email, because both can change. | | `accountId` | integer or null | The numeric trading account key, `clients.client_id`. `null` until the user links a bank account through the Trade REST API\'s `POST /api/v1/bank-accounts`; the claim is always present. The Trade REST API compares this against the account in the request path or body and returns `ACC-403` if they differ or if it is `null`. | | `roles` | array of string | Authorisation roles. `CUSTOMER` for a normal trading user, `ADMIN` for an operator. Always present, never empty. | | `iat` | integer | Issued-at, seconds since the Unix epoch. | | `exp` | integer | Expiry, seconds since the Unix epoch. Fifteen minutes after `iat` for an access token. | | `iss` | string | Issuer. Use `auth-service` for the Sprint 8 service. Consumers must validate the configured issuer. |  Decoded example:  ```json {   \"sub\": \"8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f\",   \"accountId\": 1,   \"roles\": [\"CUSTOMER\"],   \"iat\": 1790000000,   \"exp\": 1790000900,   \"iss\": \"auth-service\" } ```  Signing: `HS256` with a shared secret in development, read from `JWT_SECRET`. The auth service and Trade REST API must use the same algorithm and secret. Move to `RS256` with a published public key if a team wants the Trade REST API to verify without holding the signing secret. That is a documented upgrade, not a requirement.  Lifetimes: access token 15 minutes, refresh token 7 days. Access tokens are not revocable, which is why they are short. Refresh tokens are stored and can be revoked.  ## Security rules  These are assessed in the Sprint 8 security review.  - Store passwords with argon2id or bcrypt at cost 12 or above. Never MD5, never SHA-256, never   an unsalted hash. - Never log a password, a token, or a refresh token, including inside an error object. - Return the same response body, the same status and comparable timing for an unknown user and   for a wrong password. A different response for each is a user enumeration vulnerability. - Rotate the refresh token on every refresh, and invalidate the one that was presented. A   refresh token that is presented twice indicates theft: revoke the whole chain. - Let a caller revoke their own current session with `POST /auth/logout` without forcing every   other session they\'re logged into elsewhere to re-authenticate too. - Validate the signature, the expiry and the issuer on every protected request. Never trust a   decoded payload that has not had its signature checked. - Do not put anything in a JWT that you would not publish. The payload is base64, not encrypted.  ## Email verification rules  Registration creates the user as `PENDING` and emails a six-digit one-time code. A `PENDING` user cannot sign in. `POST /auth/verify-otp` turns the account `ACTIVE`.  - A code is stored only as a SHA-256 digest, never in the clear, and only its digest is ever   logged. Issuing a replacement burns the code it replaces, and a code is single-use. - A code expires after ten minutes and is burnt after five wrong guesses. `AUTH-410` is   returned for every failure - no code, wrong digits, expired, spent - so the response cannot   be used to discover which addresses have accounts. - `POST /auth/forgot-password` and `POST /auth/resend-otp` always answer `200` with `sent: true`,   whether or not the address is on file. A `404` there would turn the route into a directory of   accounts. - A password reset revokes every refresh token for that user, so whoever prompted the reset is   signed out everywhere. 

The version of the OpenAPI document: 1.0.0

## Building

To install the required dependencies and to build the typescript sources run:

```console
npm install
npm run build
```

## Publishing

First build the package then run `npm publish dist` (don't forget to specify the `dist` folder!)

## Consuming

Navigate to the folder of your consuming project and run one of next commands.

_published:_

```console
npm install @trading-ui/auth-api-client@1.0.0 --save
```

_without publishing (not recommended):_

```console
npm install PATH_TO_GENERATED_PACKAGE/dist.tgz --save
```

_It's important to take the tgz file, otherwise you'll get trouble with links on windows_

_using `npm link`:_

In PATH_TO_GENERATED_PACKAGE/dist:

```console
npm link
```

In your project:

```console
npm link @trading-ui/auth-api-client
```

__Note for Windows users:__ The Angular CLI has troubles to use linked npm packages.
Please refer to this issue <https://github.com/angular/angular-cli/issues/8284> for a solution / workaround.
Published packages are not effected by this issue.

### General usage

In your Angular project:

```typescript

import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '@trading-ui/auth-api-client';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideApi()
    ],
};
```

**NOTE**
If you're still using `AppModule` and haven't [migrated](https://angular.dev/reference/migrations/standalone) yet, you can still import an Angular module:
```typescript
import { ApiModule } from '@trading-ui/auth-api-client';
```

If different from the generated base path, during app bootstrap, you can provide the base path to your service.

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '@trading-ui/auth-api-client';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideApi('http://localhost:9999')
    ],
};
```

```typescript
// with a custom configuration
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '@trading-ui/auth-api-client';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideApi({
            withCredentials: true,
            username: 'user',
            password: 'password'
        })
    ],
};
```

```typescript
// with factory building a custom configuration
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi, Configuration } from '@trading-ui/auth-api-client';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        {
            provide: Configuration,
            useFactory: (authService: AuthService) => new Configuration({
                    basePath: 'http://localhost:9999',
                    withCredentials: true,
                    username: authService.getUsername(),
                    password: authService.getPassword(),
            }),
            deps: [AuthService],
            multi: false
        }
    ],
};
```

### Using multiple OpenAPI files / APIs

In order to use multiple APIs generated from different OpenAPI files,
you can create an alias name when importing the modules
in order to avoid naming conflicts:

```typescript
import { provideApi as provideUserApi } from 'my-user-api-path';
import { provideApi as provideAdminApi } from 'my-admin-api-path';
import { HttpClientModule } from '@angular/common/http';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
    providers: [
        // ...
        provideHttpClient(),
        provideUserApi(environment.basePath),
        provideAdminApi(environment.basePath),
    ],
};
```

### Customizing path parameter encoding

Without further customization, only [path-parameters][parameter-locations-url] of [style][style-values-url] 'simple'
and Dates for format 'date-time' are encoded correctly.

Other styles (e.g. "matrix") are not that easy to encode
and thus are best delegated to other libraries (e.g.: [@honoluluhenk/http-param-expander]).

To implement your own parameter encoding (or call another library),
pass an arrow-function or method-reference to the `encodeParam` property of the Configuration-object
(see [General Usage](#general-usage) above).

Example value for use in your Configuration-Provider:

```typescript
new Configuration({
    encodeParam: (param: Param) => myFancyParamEncoder(param),
})
```

[parameter-locations-url]: https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.0.md#parameter-locations
[style-values-url]: https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.0.md#style-values
[@honoluluhenk/http-param-expander]: https://www.npmjs.com/package/@honoluluhenk/http-param-expander
