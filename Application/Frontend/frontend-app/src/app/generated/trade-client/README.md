# @trading-ui/trade-api-client@1.0.0

Binding contract for the Sprint 6 Spring Boot service. Implement it exactly. The Angular UI generates its typed client from this file, so a field renamed here is a compile error there.  ## Identifiers  `accountId` means the numeric surrogate key `ACCOUNTS.id` everywhere in this contract: in the path parameter, in the order request body, and in the JWT `accountId` claim. The string business identifier lives on `ACCOUNTS.account_id` and is returned as `AccountResponse.accountId`, which is the one place the name carries the other meaning. Where any other material uses the name loosely, this contract is the one that binds.  ## Order lifecycle and the Sprint 7 change  In Sprint 6 there is no Trade Executor, so `POST /api/v1/orders` validates, fills and persists inside one request and returns `FILLED` or `REJECTED`.  From Sprint 7 execution is asynchronous. The endpoint validates, persists the order with status `NEW`, publishes it to the `orders` Kafka topic and returns `NEW`. The Trade Executor consumes the order, prices it against a live Fauxnance quote, applies the fill rules, updates the order, the cash balance and the position in one database transaction, and publishes the outcome to `trade-events`.  Both behaviours are valid responses under this contract. Clients must handle an order that is still `NEW` when the response arrives.  ## Business rules  Enforced in the order given. The first failure wins and no later rule is evaluated.  | # | Rule | Error | |---|---|---| | 1 | The account must exist | `ACC-404`, 404 | | 2 | The account must be `ACTIVE` | `ACC-403`, 403 | | 3 | The instrument must exist and be tradable | `INS-404`, 404 | | 4 | Quantity must be greater than zero | `VAL-422`, 422 | | 5 | Price must be greater than zero | `VAL-422`, 422 | | 6 | BUY: cash balance must be at least quantity multiplied by price | `ORD-400`, 400 | | 7 | SELL: held quantity must be at least the order quantity | `ORD-409`, 409 | | 8 | The idempotency key must be unique | `ORD-409`, 409 |  Rules 9 and 10 have no error code. Cash and position update atomically, in one transaction. Every order is recorded, including rejected ones, because the order table is the audit trail.  Rule 8 is enforced by the unique constraint on `orders.idempotency_key`, not by a read followed by a write. A read-then-write check has a race that two concurrent requests will find.  ## Authentication  Every `/api/v1/_**` route requires a valid signed JWT in the `Authorization` header. A missing, malformed, expired or wrongly signed token is `AUTH-401`, 401. A valid token whose `accountId` claim does not match the account being addressed is `ACC-403`, 403: a token proves who you are, not what you may reach.  A registered user who has not linked a bank account yet holds a token whose `accountId` claim is `null`. Every account and order route answers that token with `ACC-403`. The one route it is meant for is `POST /api/v1/bank-accounts`, which creates the user\'s trading account. After linking, the client calls `/auth/refresh` to get a token that carries the new `accountId`. 

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
npm install @trading-ui/trade-api-client@1.0.0 --save
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
npm link @trading-ui/trade-api-client
```

__Note for Windows users:__ The Angular CLI has troubles to use linked npm packages.
Please refer to this issue <https://github.com/angular/angular-cli/issues/8284> for a solution / workaround.
Published packages are not effected by this issue.

### General usage

In your Angular project:

```typescript

import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '@trading-ui/trade-api-client';

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
import { ApiModule } from '@trading-ui/trade-api-client';
```

If different from the generated base path, during app bootstrap, you can provide the base path to your service.

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApi } from '@trading-ui/trade-api-client';

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
import { provideApi } from '@trading-ui/trade-api-client';

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
import { provideApi, Configuration } from '@trading-ui/trade-api-client';

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
