import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { SessionStore } from '../auth/session.store';
import { ChatStore, MAX_MESSAGES_SENT, MAX_TEXT } from './chat.store';

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
    expect(store.messages()).toEqual([{ role: 'user', text: 'How is my portfolio?', suggestions: [] }]);

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
      suggestions: [{ symbol: 'TCS', side: 'SELL', quantity: 2, reason: 'Concentration' }]
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
      suggestions: []
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

  it('toggles and closes the panel', () => {
    configure();

    store.toggle();
    expect(store.open()).toBe(true);
    store.close();
    expect(store.open()).toBe(false);
  });
});
