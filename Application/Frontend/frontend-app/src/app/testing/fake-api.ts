import { HttpTestingController, TestRequest } from '@angular/common/http/testing';

interface Route {
  matches: (request: TestRequest) => boolean;
  status: number;
  body: unknown;
}

/**
 * A tiny stand-in backend for component specs: register what each URL answers, then `flush()`
 * answers every request the component has made so far. A request nobody registered a route for
 * fails the test, which is the point - a component asking for something unexpected is a bug.
 */
export class FakeApi {
  private readonly routes: Route[] = [];
  readonly requested: string[] = [];

  constructor(private readonly http: HttpTestingController) {}

  /** Answers any GET whose URL ends with `suffix` (query string ignored). */
  get(suffix: string, body: unknown, status = 200): this {
    return this.on((r) => r.request.method === 'GET' && r.request.url.endsWith(suffix), body, status);
  }

  on(matches: (request: TestRequest) => boolean, body: unknown, status = 200): this {
    // Later registrations win, so a test can override a default.
    this.routes.unshift({ matches, status, body });
    return this;
  }

  /** Replaces whatever a URL suffix answered before. */
  set(suffix: string, body: unknown, status = 200): this {
    return this.get(suffix, body, status);
  }

  /** Answers everything outstanding, repeatedly, until the page goes quiet. Returns how many. */
  flush(): number {
    let answered = 0;
    for (let round = 0; round < 8; round++) {
      const open = this.http.match(() => true).filter((request) => !request.cancelled);
      if (open.length === 0) {
        break;
      }
      for (const request of open) {
        // Answering one request can cancel its siblings (a failed forkJoin drops the rest).
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
