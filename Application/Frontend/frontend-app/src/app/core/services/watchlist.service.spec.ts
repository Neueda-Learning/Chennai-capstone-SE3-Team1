import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { WatchlistService } from './watchlist.service';

const BASE = 'http://trade.test/api/v1/accounts/42';
const LIST = '6f1c1c0e-8c1e-4d3b-9a43-0d4f1f0d2a11';

describe('WatchlistService', () => {
  let service: WatchlistService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    service = TestBed.inject(WatchlistService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the watchlists on the account-scoped route', () => {
    service.list(42).subscribe();

    const request = http.expectOne(`${BASE}/watchlists`);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('creates a watchlist with only a name', () => {
    service.create(42, 'Banks').subscribe();

    const request = http.expectOne(`${BASE}/watchlists`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Banks' });
    request.flush({});
  });

  it('adds and removes an instrument under its watchlist', () => {
    service.addInstrument(42, LIST, 'TCS').subscribe();
    const add = http.expectOne(`${BASE}/watchlists/${LIST}/instruments`);
    expect(add.request.method).toBe('POST');
    expect(add.request.body).toEqual({ symbol: 'TCS' });
    add.flush({});

    service.removeInstrument(42, LIST, 'TCS').subscribe();
    const remove = http.expectOne(`${BASE}/watchlists/${LIST}/instruments/TCS`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null);
  });

  it('deletes a watchlist', () => {
    service.remove(42, LIST).subscribe();

    const request = http.expectOne(`${BASE}/watchlists/${LIST}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });

  it('creates an alert with a symbol, a threshold and a direction, and nothing else', () => {
    service.createAlert(42, { symbol: 'TCS', threshold: 3500.5, direction: 'ABOVE' }).subscribe();

    const request = http.expectOne(`${BASE}/alerts`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ symbol: 'TCS', threshold: 3500.5, direction: 'ABOVE' });
    request.flush({});
  });

  it('re-arms and disables an alert by PATCHing its state', () => {
    service.setAlertState(42, 'a-1', 'ARMED').subscribe();
    const rearm = http.expectOne(`${BASE}/alerts/a-1`);
    expect(rearm.request.method).toBe('PATCH');
    expect(rearm.request.body).toEqual({ state: 'ARMED' });
    rearm.flush({});

    service.setAlertState(42, 'a-1', 'DISABLED').subscribe();
    const disable = http.expectOne(`${BASE}/alerts/a-1`);
    expect(disable.request.body).toEqual({ state: 'DISABLED' });
    disable.flush({});
  });

  it('lists and deletes alerts on the account-scoped route', () => {
    service.alerts(42).subscribe();
    http.expectOne(`${BASE}/alerts`).flush([]);

    service.removeAlert(42, 'a-1').subscribe();
    const request = http.expectOne(`${BASE}/alerts/a-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });
});
