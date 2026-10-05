import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { MarketService } from './market.service';
import { PortfolioService } from './portfolio.service';

describe('MarketService and PortfolioService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the latest quotes', () => {
    let result: unknown;
    TestBed.inject(MarketService).getQuotes().subscribe((quotes) => (result = quotes));

    const request = http.expectOne('http://trade.test/api/v1/market/quotes');
    expect(request.request.method).toBe('GET');
    request.flush([{ symbol: 'RELIANCE' }]);

    expect(result).toEqual([{ symbol: 'RELIANCE' }]);
  });

  it('reads a symbol history, with the limit when one is given', () => {
    const service = TestBed.inject(MarketService);
    service.getHistory('RELIANCE', 60).subscribe();
    service.getHistory('TCS').subscribe();

    expect(http.expectOne('http://trade.test/api/v1/market/quotes/RELIANCE/history?limit=60').request.method).toBe('GET');
    expect(http.expectOne('http://trade.test/api/v1/market/quotes/TCS/history').request.method).toBe('GET');
  });

  it('encodes a symbol that is not path-safe', () => {
    TestBed.inject(MarketService).getHistory('A/B').subscribe();

    http.expectOne('http://trade.test/api/v1/market/quotes/A%2FB/history');
  });

  it('reads candles at the chosen interval over the chosen range', () => {
    let result: unknown;
    TestBed.inject(MarketService).getCandles('RELIANCE', '15m', '1d').subscribe((candles) => (result = candles));

    const request = http.expectOne('http://trade.test/api/v1/market/quotes/RELIANCE/candles?interval=15m&range=1d');
    expect(request.request.method).toBe('GET');
    request.flush([{ time: '2026-10-03T10:00:00+05:30', open: 1, high: 2, low: 0.5, close: 1.5, volume: null }]);

    expect(result).toEqual([{ time: '2026-10-03T10:00:00+05:30', open: 1, high: 2, low: 0.5, close: 1.5, volume: null }]);
  });

  it('reads the portfolio of the account', () => {
    let result: unknown;
    TestBed.inject(PortfolioService).getPortfolio(7).subscribe((portfolio) => (result = portfolio));

    http.expectOne('http://trade.test/api/v1/accounts/7/portfolio').flush({ accountId: 7, holdings: [], positions: [] });

    expect(result).toEqual({ accountId: 7, holdings: [], positions: [] });
  });
});
