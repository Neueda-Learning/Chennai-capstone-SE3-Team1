import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { Advice } from '../../core/services/advice.service';
import { BUY_TCS } from '../../testing/advice-fixtures';
import { provideApi as provideTradeApi } from '../../generated/trade-client';
import { AdviceIdeas } from './advice-ideas';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const URL = 'http://trade.test/api/v1/accounts/42/advice';

const ADVICE: Advice = {
  accountId: 42,
  model: 'm1',
  methodology: 'rules',
  disclaimer: 'Information',
  generatedAt: '2026-10-06T18:00:00',
  dataAsOf: '2026-10-06',
  stale: true,
  signals: [BUY_TCS],
  ideas: { buy: [BUY_TCS], sell: [{ ...BUY_TCS, symbol: 'ITC', suggestion: 'SELL', score: -45 }] }
};

describe('AdviceIdeas', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdviceIdeas],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        provideTradeApi({ basePath: 'http://trade.test' })]
    });
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('shows the customer\'s signals with predictions and the strongest buys and sells', () => {
    const fixture = TestBed.createComponent(AdviceIdeas);
    fixture.detectChanges();
    http.expectOne(URL).flush(ADVICE);
    fixture.detectChanges();
    const card = fixture.nativeElement as HTMLElement;

    expect(card.querySelector('[data-testid="ideas-mine"]')?.textContent).toContain('TCS');
    expect(card.querySelector('[data-testid="ideas-mine"]')?.textContent).toContain('112.40');
    expect(card.querySelector('[data-testid="ideas-buy"]')?.textContent).toContain('TCS');
    expect(card.querySelector('[data-testid="ideas-sell"]')?.textContent).toContain('ITC');
    expect(card.querySelector('[data-testid="ideas-stale"]')).not.toBeNull();
  });

  it('says so when nothing has been published, and when loading fails', () => {
    const empty = TestBed.createComponent(AdviceIdeas);
    empty.detectChanges();
    http.expectOne(URL).flush({ ...ADVICE, dataAsOf: null, signals: [], ideas: { buy: [], sell: [] } });
    empty.detectChanges();
    expect((empty.nativeElement as HTMLElement).querySelector('[data-testid="ideas-none"]')).not.toBeNull();

    const failed = TestBed.createComponent(AdviceIdeas);
    failed.detectChanges();
    http.expectOne(URL).flush({}, { status: 500, statusText: 'error' });
    failed.detectChanges();
    expect((failed.nativeElement as HTMLElement).querySelector('[data-testid="ideas-failed"]')).not.toBeNull();
  });
});
