import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { NotificationHistoryService } from './notification-history.service';

const URL = 'http://trade.test/api/v1/accounts/42/notification-history';

describe('NotificationHistoryService', () => {
  let service: NotificationHistoryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    service = TestBed.inject(NotificationHistoryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the first page from the account-scoped history route', () => {
    let result: unknown;
    service.list(42).subscribe((value) => (result = value));

    const request = http.expectOne(URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    request.flush([]);
    expect(result).toEqual([]);
  });

  it('sends limit and the before cursor when paging', () => {
    service.list(42, { limit: 20, before: '2026-10-06T10:00:00Z' }).subscribe();

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('before')).toBe('2026-10-06T10:00:00Z');
    request.flush([]);
  });
});
