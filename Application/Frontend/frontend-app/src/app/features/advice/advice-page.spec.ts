import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { Advice, TradeSignal } from '../../core/services/advice.service';
import { BUY_TCS } from '../../testing/advice-fixtures';
import { provideApi as provideTradeApi } from '../../generated/trade-client';
import { AdvicePage } from './advice-page';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const URL = 'http://trade.test/api/v1/accounts/42/advice';


const NOTHING_PUBLISHED: TradeSignal = {
  ...BUY_TCS,
  symbol: 'INFY',
  name: 'Infosys',
  sources: ['WATCHLIST'],
  heldQuantity: null,
  averageCost: null,
  status: 'INSUFFICIENT_DATA',
  suggestion: null,
  confidence: null,
  score: null,
  summary: 'No analysis has been published for INFY yet; it appears after the next analysis run.',
  reasons: [],
  indicators: null,
  asOf: null,
  stale: true,
  prediction: null
};

function advice(signals: TradeSignal[], stale = false): Advice {
  return {
    accountId: 42,
    model: 'trend-momentum-rsi/drift-vol v1',
    methodology: 'Computed by the ETL analysis job from daily closing prices.',
    disclaimer: 'It is information, not a personal recommendation.',
    generatedAt: '2026-10-06T18:00:00',
    dataAsOf: '2026-10-06',
    stale,
    signals,
    ideas: { buy: [BUY_TCS], sell: [] }
  };
}

describe('AdvicePage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdvicePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        provideTradeApi({ basePath: 'http://trade.test' })]
    });
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  function render(body: Advice): ComponentFixture<AdvicePage> {
    const fixture = TestBed.createComponent(AdvicePage);
    fixture.detectChanges();
    http.expectOne(URL).flush(body);
    fixture.detectChanges();
    return fixture;
  }

  it('shows each signal with its suggestion, reasons, prediction and the numbers', () => {
    const page = render(advice([BUY_TCS, NOTHING_PUBLISHED])).nativeElement as HTMLElement;
    const tcs = page.querySelector('[data-testid="signal-TCS"]')!;

    expect(tcs.querySelector('[data-testid="signal-direction"]')?.textContent).toContain('BUY');
    expect(tcs.querySelector('[data-testid="signal-direction"]')?.textContent).toContain('high');
    expect(tcs.querySelectorAll('[data-testid="signal-reasons"] li')).toHaveLength(2);
    expect(tcs.querySelector('[data-testid="signal-prediction"]')?.textContent).toContain('2026-10-07');
    expect(tcs.querySelector('[data-testid="signal-prediction"]')?.textContent).toContain('53%');
    expect(tcs.textContent).toContain('Held · Watched');
    expect(page.querySelector('[data-testid="advice-disclaimer"]')?.textContent).toContain('not a personal recommendation');
    expect(page.querySelector('[data-testid="advice-as-of"]')?.textContent).toContain('2026-10-06');
    expect(tcs.querySelector('[data-testid="signal-trade"]')?.getAttribute('href'))
      .toBe('/app/orders?symbol=TCS&schedule=level');
  });

  it('shows "No suggestion" and why when nothing has been published for a symbol', () => {
    const infy = (render(advice([NOTHING_PUBLISHED])).nativeElement as HTMLElement).querySelector('[data-testid="signal-INFY"]')!;

    expect(infy.querySelector('[data-testid="signal-direction"]')?.textContent).toContain('No suggestion');
    expect(infy.querySelector('[data-testid="signal-reason"]')?.textContent).toContain('No analysis has been published');
  });

  it('marks stale data', () => {
    const page = render(advice([BUY_TCS], true)).nativeElement as HTMLElement;

    expect(page.querySelector('[data-testid="advice-stale"]')).not.toBeNull();
  });

  it('explains an empty list', () => {
    const page = render(advice([])).nativeElement as HTMLElement;

    expect(page.querySelector('[data-testid="advice-empty"]')).not.toBeNull();
  });

  it('shows the catalogue message when the account is refused', () => {
    const fixture = TestBed.createComponent(AdvicePage);
    fixture.detectChanges();
    http.expectOne(URL).flush({ errorCode: 'ACC-403', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="advice-error"]')?.textContent)
      .toContain('not the one this sign-in may trade');
  });

  it('asks for nothing when nobody is signed in', () => {
    TestBed.inject(SessionStore).signOut();
    TestBed.createComponent(AdvicePage).detectChanges();
    http.expectNone(URL);
  });
});
