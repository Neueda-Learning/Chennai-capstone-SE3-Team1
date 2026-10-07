import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { SessionStore } from '../auth/session.store';
import { ChatEntry, ChatStore, MAX_MESSAGES_SENT, MAX_TEXT } from './chat.store';

const BASE = 'http://trade.test';
const URL = `${BASE}/api/v1/accounts/7/chat`;

describe('ChatStore', () => {
  let http: HttpTestingController;
  let store: ChatStore;
  let session: SessionStore;

  function configure(signedIn = true): void {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: BASE })]
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    if (signedIn) {
      session.signIn('token', 7);
    }
    store = TestBed.inject(ChatStore);
    TestBed.tick();
  }

  afterEach(() => {
    http?.verify();
  });

  it('is available only while signed in with an account', () => {
    configure(false);
    expect(store.available()).toBe(false);

    session.signIn('token', 7);
    expect(store.available()).toBe(true);

    session.signOut();
    expect(store.available()).toBe(false);
  });

  it('posts the conversation to the signed-in account and appends the reply with its suggestions', () => {
    configure();

    store.send('  How is my portfolio?  ');
    expect(store.sending()).toBe(true);
    expect(store.messages()).toEqual([
      { role: 'user', text: 'How is my portfolio?', suggestions: [], alerts: [], lists: [], links: [] }
    ]);

    const request = http.expectOne(URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ messages: [{ role: 'user', text: 'How is my portfolio?' }] });
    request.flush({
      reply: 'You hold TCS.',
      suggestions: [{ symbol: 'TCS', side: 'SELL', quantity: 2, reason: 'Concentration' }]
    });

    expect(store.sending()).toBe(false);
    expect(store.messages()[1]).toEqual({
      role: 'assistant',
      text: 'You hold TCS.',
      suggestions: [{ symbol: 'TCS', side: 'SELL', quantity: 2, reason: 'Concentration' }],
      alerts: [],
      lists: [],
      links: [],
      orders: []
    });
  });

  it('sends the earlier turns with each new question', () => {
    configure();
    store.send('Hello');
    http.expectOne(URL).flush({ reply: 'Hi', suggestions: [] });

    store.send('Is TCS risky?');

    expect(http.expectOne(URL).request.body.messages).toEqual([
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi' },
      { role: 'user', text: 'Is TCS risky?' }
    ]);
  });

  it('ignores an empty message, an over-long one, and anything sent while a reply is awaited', () => {
    configure();

    store.send('   ');
    store.send('x'.repeat(MAX_TEXT + 1));
    http.expectNone(URL);

    store.send('first');
    store.send('second');
    http.expectOne(URL).flush({ reply: 'ok', suggestions: [] });
    expect(store.messages().filter((m) => m.role === 'user').length).toBe(1);
  });

  it('does nothing without an account', () => {
    configure(false);

    store.send('hi');

    http.expectNone(() => true);
    expect(store.messages()).toEqual([]);
  });

  it('keeps only the most recent turns, beginning with a user turn, each within the length limit', () => {
    configure();
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: i % 2 === 1 ? 'a'.repeat(MAX_TEXT + 500) : `q${i}`,
      suggestions: [],
      alerts: [],
      lists: [],
      links: []
    }));
    store.messages.set(history);

    store.send('latest');

    const sent = http.expectOne(URL).request.body.messages as { role: string; text: string }[];
    expect(sent.length).toBeLessThanOrEqual(MAX_MESSAGES_SENT);
    expect(sent[0].role).toBe('user');
    expect(sent[sent.length - 1]).toEqual({ role: 'user', text: 'latest' });
    expect(sent.every((m) => m.text.length <= MAX_TEXT)).toBe(true);
  });

  describe('when the question cannot be answered', () => {
    it('takes the question back out, hands its text back, and explains a rate limit', () => {
      configure();
      store.send('Another one');

      http.expectOne(URL).flush({ errorCode: 'CHT-429', message: 'x' }, { status: 429, statusText: 'Too Many Requests' });

      expect(store.messages()).toEqual([]);
      expect(store.draft()).toBe('Another one');
      expect(store.error()).toContain('too quickly');
      expect(store.sending()).toBe(false);
    });

    it('says the assistant is unavailable when the model could not be reached', () => {
      configure();
      store.send('hi');

      http.expectOne(URL).flush({ errorCode: 'CHT-503', message: 'x' }, { status: 503, statusText: 'Unavailable' });

      expect(store.error()).toContain('unavailable');
    });

    it('says the trading service cannot be reached when the network is down', () => {
      configure();
      store.send('hi');

      http.expectOne(URL).error(new ProgressEvent('error'));

      expect(store.error()).toContain('Could not reach');
    });

    it('clears the error on the next attempt', () => {
      configure();
      store.send('hi');
      http.expectOne(URL).flush({}, { status: 500, statusText: 'Server Error' });
      expect(store.error()).not.toBeNull();

      store.send('hi again');

      expect(store.error()).toBeNull();
      http.expectOne(URL);
    });
  });

  it('empties the conversation when the user signs out, so the next person never sees it', () => {
    configure();
    store.send('private question');
    http.expectOne(URL).flush({ reply: 'private answer', suggestions: [] });
    store.open.set(true);

    session.signOut();
    TestBed.tick();

    expect(store.messages()).toEqual([]);
    expect(store.open()).toBe(false);
    expect(sessionStorage.getItem('tui.chat.v1')).toBeNull();
  });

  it('keeps the conversation across a page reload within the tab', () => {
    configure();
    store.send('remember me');
    http.expectOne(URL).flush({ reply: 'ok', suggestions: [] });
    TestBed.tick();
    const saved = sessionStorage.getItem('tui.chat.v1');
    expect(saved).toContain('remember me');

    TestBed.resetTestingModule();
    sessionStorage.setItem('tui.chat.v1', saved as string);
    configure();

    expect(store.messages().map((m) => m.text)).toEqual(['remember me', 'ok']);
  });

  it('starts empty when stored data is damaged or of the wrong shape', () => {
    sessionStorage.setItem('tui.chat.v1', '{not json');
    configure();
    expect(store.messages()).toEqual([]);

    TestBed.resetTestingModule();
    sessionStorage.setItem('tui.chat.v1', JSON.stringify([{ role: 'system', text: 'x', suggestions: [] }, 5, null]));
    configure();
    expect(store.messages()).toEqual([]);
  });

  describe('proposals', () => {
    const ALERTS = `${BASE}/api/v1/accounts/7/alerts`;
    const LISTS = `${BASE}/api/v1/accounts/7/watchlists`;
    const alertProposal = {
      symbol: 'TCS',
      threshold: 2850,
      direction: 'BELOW',
      reason: 'Support',
      currentPrice: 3000,
      percentFromNow: -5
    };

    function reply(extra: Record<string, unknown>): void {
      store.send('hello');
      http.expectOne(URL).flush({ reply: 'ok', suggestions: [], ...extra });
    }

    const last = (): ChatEntry => store.messages().at(-1) as ChatEntry;

    it('shows proposals as cards that have not been acted on, and nothing is sent to the server by them', () => {
      configure();

      reply({ alertProposals: [alertProposal], watchlistProposals: [{ mode: 'CREATE', name: 'Banks', watchlistId: null, symbols: ['SBIN'], reason: 'r' }] });

      expect(last().alerts[0]).toEqual({ proposal: alertProposal, status: 'idle', note: null });
      expect(last().lists[0].status).toBe('idle');
      http.expectNone(ALERTS);
      http.expectNone(LISTS);
    });

    it('creates the alert only when the customer confirms, with the proposed level and direction', () => {
      configure();
      reply({ alertProposals: [alertProposal] });

      store.confirmAlert(last(), 0);
      expect(last().alerts[0].status).toBe('working');
      const request = http.expectOne(ALERTS);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ symbol: 'TCS', threshold: 2850, direction: 'BELOW' });
      request.flush({ id: 'a1', symbol: 'TCS', threshold: 2850, direction: 'BELOW', state: 'ARMED' });

      expect(last().alerts[0].status).toBe('done');
    });

    it('does not create it twice if pressed again while working or after it is done', () => {
      configure();
      reply({ alertProposals: [alertProposal] });
      const entry = last();

      store.confirmAlert(entry, 0);
      store.confirmAlert(last(), 0);
      http.expectOne(ALERTS).flush({ id: 'a1' });
      store.confirmAlert(last(), 0);

      http.expectNone(ALERTS);
    });

    it('lets a failed alert be tried again, and a declined one goes away', () => {
      configure();
      reply({ alertProposals: [alertProposal, { ...alertProposal, symbol: 'INFY' }] });

      store.confirmAlert(last(), 0);
      http.expectOne(ALERTS).flush({}, { status: 500, statusText: 'x' });
      expect(last().alerts[0].status).toBe('failed');
      expect(last().alerts[0].note).not.toBeNull();

      store.confirmAlert(last(), 0);
      http.expectOne(ALERTS).flush({ id: 'a1' });
      expect(last().alerts[0].status).toBe('done');

      store.dismiss(last(), 'alerts', 1);
      expect(last().alerts[1].status).toBe('dismissed');
      http.expectNone(ALERTS);
    });

    it('places a proposed conditional order only when confirmed, with the customer account and a fresh key', () => {
      configure();
      const proposal = {
        symbol: 'TCS', side: 'BUY', quantity: 2, limitPrice: 3510, conditionType: 'PRICE_AT_OR_BELOW', triggerPrice: 3500,
        shortWindow: null, longWindow: null, bandWidth: null, expiresInDays: 30,
        condition: 'when the price falls to 3500.00 or lower', reason: 'Buy the dip', currentPrice: 3600
      };
      reply({ conditionalOrderProposals: [proposal] });
      expect(last().orders?.[0].status).toBe('idle');
      http.expectNone(`${BASE}/api/v1/orders/conditional`);

      store.confirmOrder(last(), 0);
      const request = http.expectOne(`${BASE}/api/v1/orders/conditional`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toMatchObject({
        accountId: 7, symbol: 'TCS', side: 'BUY', quantity: 2, price: 3510, expiresInDays: 30,
        condition: { type: 'PRICE_AT_OR_BELOW', triggerPrice: 3500 }
      });
      expect(request.request.body.condition).not.toHaveProperty('shortWindow');
      expect(request.request.body.idempotencyKey).toMatch(/^chat-/);
      request.flush({ orderId: 'ORD-9', status: 'PENDING', message: 'Held' });

      expect(last().orders?.[0].status).toBe('done');
      expect(last().orders?.[0].note).toBe('ORD-9');
      store.confirmOrder(last(), 0);
      http.expectNone(`${BASE}/api/v1/orders/conditional`);
    });

    it('shows why a conditional order was refused and lets it be tried again', () => {
      configure();
      reply({ conditionalOrderProposals: [{
        symbol: 'TCS', side: 'BUY', quantity: 2, limitPrice: 3510, conditionType: 'PRICE_AT_OR_BELOW', triggerPrice: 3500,
        shortWindow: null, longWindow: null, bandWidth: null, expiresInDays: 30, condition: 'c', reason: 'r', currentPrice: 3600
      }] });

      store.confirmOrder(last(), 0);
      http.expectOne(`${BASE}/api/v1/orders/conditional`)
        .flush({ errorCode: 'COND-429', message: 'cap' }, { status: 429, statusText: 'x' });
      expect(last().orders?.[0].status).toBe('failed');
      expect(last().orders?.[0].note).toContain('25 conditional orders');
    });

    it('creates a new watchlist and then puts the stocks in it', () => {
      configure();
      reply({ watchlistProposals: [{ mode: 'CREATE', name: 'Banks', watchlistId: null, symbols: ['SBIN', 'HDFCBANK'], reason: 'r' }] });

      store.confirmList(last(), 0);
      const create = http.expectOne(LISTS);
      expect(create.request.body).toEqual({ name: 'Banks' });
      create.flush({ id: 'w9', name: 'Banks', createdAt: 'now', instruments: [] });
      const requests = http.match(`${LISTS}/w9/instruments`);
      expect(requests.map((r) => r.request.body.symbol).sort()).toEqual(['HDFCBANK', 'SBIN']);
      requests.forEach((r) =>
        r.flush({ symbol: r.request.body.symbol, name: 'n', price: 1, currency: 'INR', changePercent: 0, stale: false, quoteAsOf: null })
      );

      expect(last().lists[0].status).toBe('done');
    });

    it('adds to the customer\'s own watchlist without creating another', () => {
      configure();
      reply({ watchlistProposals: [{ mode: 'ADD', name: 'Banks', watchlistId: 'w1', symbols: ['SBIN'], reason: 'r' }] });

      store.confirmList(last(), 0);

      http.expectNone(LISTS);
      http.expectOne(`${LISTS}/w1/instruments`).flush({ symbol: 'SBIN', name: 'n', price: 1, currency: 'INR', changePercent: 0, stale: false, quoteAsOf: null });
      expect(last().lists[0].status).toBe('done');
    });

    it('reports a watchlist that could not be made', () => {
      configure();
      reply({ watchlistProposals: [{ mode: 'CREATE', name: 'Banks', watchlistId: null, symbols: ['SBIN'], reason: 'r' }] });

      store.confirmList(last(), 0);
      http.expectOne(LISTS).flush({}, { status: 500, statusText: 'x' });

      expect(last().lists[0].status).toBe('failed');
    });

    it('keeps only links to the app\'s own pages', () => {
      configure();

      reply({
        links: [
          { label: 'Settings', path: '/app/settings', query: {} },
          { label: 'Elsewhere', path: 'https://evil.example', query: {} },
          { label: 'Other', path: '/admin', query: {} }
        ]
      });

      expect(last().links.map((l) => l.path)).toEqual(['/app/settings']);
    });

    it('restores cards from the session, and one that was mid-request waits for a click again', () => {
      configure();
      reply({ alertProposals: [alertProposal, { ...alertProposal, symbol: 'INFY' }] });
      store.confirmAlert(last(), 0); // left working
      http.expectOne(ALERTS);
      store.dismiss(last(), 'alerts', 1);
      TestBed.tick();
      const saved = sessionStorage.getItem('tui.chat.v1');

      TestBed.resetTestingModule();
      sessionStorage.setItem('tui.chat.v1', saved as string);
      configure();

      expect(last().alerts.map((c) => c.status)).toEqual(['idle', 'dismissed']);
    });
  });

  it('toggles and closes the panel', () => {
    configure();

    store.toggle();
    expect(store.open()).toBe(true);
    store.close();
    expect(store.open()).toBe(false);
  });
});
