import { HttpTestingController, TestRequest } from '@angular/common/http/testing';

interface Route {
  matches: (request: TestRequest) => boolean;
  status: number;
  body: unknown;
}

export class FakeApi {
  private readonly routes: Route[] = [];
  readonly requested: string[] = [];

  constructor(private readonly http: HttpTestingController) {}

  get(suffix: string, body: unknown, status = 200): this {
    return this.on((r) => r.request.method === 'GET' && r.request.url.endsWith(suffix), body, status);
  }

  on(matches: (request: TestRequest) => boolean, body: unknown, status = 200): this {
    this.routes.unshift({ matches, status, body });
    return this;
  }

  set(suffix: string, body: unknown, status = 200): this {
    return this.get(suffix, body, status);
  }

  flush(): number {
    let answered = 0;
    for (let round = 0; round < 8; round++) {
      const open = this.http.match(() => true).filter((request) => !request.cancelled);
      if (open.length === 0) {
        break;
      }
      for (const request of open) {
        if (request.cancelled) {
          continue;
        }
        this.requested.push(`${request.request.method} ${request.request.urlWithParams}`);
        const route = this.routes.find((candidate) => candidate.matches(request));
        if (route === undefined) {
          throw new Error(`FakeApi: no route for ${request.request.method} ${request.request.urlWithParams}`);
        }
        if (route.status >= 400) {
          request.flush(route.body as never, { status: route.status, statusText: 'error' });
        } else {
          request.flush(route.body as never);
        }
        answered++;
      }
    }
    return answered;
  }

  count(fragment: string): number {
    return this.requested.filter((entry) => entry.includes(fragment)).length;
  }
}
