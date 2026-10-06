import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideApi } from '../../generated/trade-client';
import { SessionStore } from '../auth/session.store';
import { ChatWidget, orderLink } from './chat-widget';
import { ChatStore } from './chat.store';

@Component({ selector: 'tui-stub-orders', template: '' })
class StubOrders {}

const BASE = 'http://trade.test';
const URL = `${BASE}/api/v1/accounts/7/chat`;

describe('ChatWidget', () => {
  let fixture: ComponentFixture<ChatWidget>;
  let http: HttpTestingController;
  let store: ChatStore;
  let session: SessionStore;
  let router: Router;

  function setUp(signedIn = true): void {
    TestBed.configureTestingModule({
      imports: [ChatWidget],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: BASE }),
        provideRouter([{ path: 'app/orders', component: StubOrders }])
      ]
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
    store = TestBed.inject(ChatStore);
    if (signedIn) {
      session.signIn('token', 7);
    }
    fixture = TestBed.createComponent(ChatWidget);
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(testId: string): T | null =>
    el().querySelector<T>(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] => Array.from(el().querySelectorAll(`[data-testid="${testId}"]`));

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(): Promise<void> {
    q('chat-launcher')?.click();
    await settle();
  }

  async function type(text: string): Promise<HTMLTextAreaElement> {
    const box = q<HTMLTextAreaElement>('chat-input') as HTMLTextAreaElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    await settle();
    return box;
  }

  afterEach(() => http?.verify());

  describe('availability', () => {
    it('shows nothing when nobody is signed in', async () => {
      setUp(false);
      await settle();

      expect(q('chat-launcher')).toBeNull();
      expect(q('chat-panel')).toBeNull();
    });

    it('shows only the launcher to a signed-in customer, and opens and closes the panel with it', async () => {
      setUp();
      expect(q('chat-launcher')).not.toBeNull();
      expect(q('chat-panel')).toBeNull();

      await open();
      expect(q('chat-panel')).not.toBeNull();
      expect(q('chat-launcher')?.getAttribute('aria-expanded')).toBe('true');

      q('chat-launcher')?.click();
      await settle();
      expect(q('chat-panel')).toBeNull();
    });

    it('closes on Escape and with the close button', async () => {
      setUp();
      await open();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(q('chat-panel')).toBeNull();

      await open();
      q('chat-close')?.click();
      await settle();
      expect(q('chat-panel')).toBeNull();
    });
  });

  describe('asking', () => {
    it('offers starter questions on an empty conversation, and a starter sends itself', async () => {
      setUp();
      await open();
      expect(all('chat-starter').length).toBe(3);

      all('chat-starter')[0].click();
      await settle();

      const request = http.expectOne(URL);
      expect(request.request.body.messages[0].text).toBe('How is my portfolio doing?');
      expect(all('chat-starter').length).toBe(0); // the intro gives way to the conversation
      request.flush({ reply: 'Here you go.', suggestions: [] });
    });

    it('sends on Enter, not on Shift+Enter, and clears the box', async () => {
      setUp();
      await open();
      const box = await type('Is TCS risky?');

      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }));
      await settle();
      http.expectNone(URL);

      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      box.dispatchEvent(enter);
      await settle();

      expect(enter.defaultPrevented).toBe(true);
      http.expectOne(URL).flush({ reply: 'ok', suggestions: [] });
      await settle();
      expect((q<HTMLTextAreaElement>('chat-input') as HTMLTextAreaElement).value).toBe('');
    });

    it('will not send an empty box, and disables the box and button while an answer is awaited', async () => {
      setUp();
      await open();
      expect((q<HTMLButtonElement>('chat-send') as HTMLButtonElement).disabled).toBe(true);

      await type('Question');
      expect((q<HTMLButtonElement>('chat-send') as HTMLButtonElement).disabled).toBe(false);
      q('chat-send')?.click();
      await settle();

      expect(q('chat-typing')).not.toBeNull();
      expect((q<HTMLTextAreaElement>('chat-input') as HTMLTextAreaElement).disabled).toBe(true);
      http.expectOne(URL).flush({ reply: 'Done', suggestions: [] });
      await settle();
      expect(q('chat-typing')).toBeNull();
      expect((q<HTMLTextAreaElement>('chat-input') as HTMLTextAreaElement).disabled).toBe(false);
    });
  });

  describe('showing answers', () => {
    it('renders bold and bullets from the answer', async () => {
      setUp();
      await open();
      store.messages.set([
        { role: 'user', text: 'Hi', suggestions: [] },
        { role: 'assistant', text: 'You hold **TCS**.\n* first point\n* second point', suggestions: [] }
      ]);
      await settle();

      const answer = all('chat-message')[1];
      expect(answer.querySelector('.chat-bold')?.textContent).toBe('TCS');
      expect(answer.querySelectorAll('.chat-bullet').length).toBe(2);
      expect(all('chat-message')[0].getAttribute('data-role')).toBe('user');
    });

    it('renders a heading as a heading, without the hash marks', async () => {
      setUp();
      await open();
      store.messages.set([{ role: 'assistant', text: '### Statistical Outlook\nThe stock leans bearish.', suggestions: [] }]);
      await settle();

      const answer = all('chat-message')[0];
      expect(answer.querySelector('.chat-heading')?.textContent?.trim()).toBe('Statistical Outlook');
      expect(answer.textContent).not.toContain('###');
    });

    it('shows text from the model as text, never as markup', async () => {
      setUp();
      await open();
      store.messages.set([
        { role: 'assistant', text: '<img src=x onerror="window.__pwned=1"> <b>not bold</b>', suggestions: [] }
      ]);
      await settle();

      const answer = all('chat-message')[0];
      expect(answer.querySelector('img')).toBeNull();
      expect(answer.querySelector('b')).toBeNull();
      expect(answer.textContent).toContain('<img src=x onerror="window.__pwned=1">');
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    });
  });

  describe('suggestions', () => {
    const suggestion = { symbol: 'TCS', side: 'SELL' as const, quantity: 20, reason: 'Reduces concentration' };

    it('shows a suggestion as a card with the side, quantity, symbol and reason', async () => {
      setUp();
      await open();
      store.messages.set([{ role: 'assistant', text: 'Consider this.', suggestions: [suggestion] }]);
      await settle();

      const card = q('chat-suggestion') as HTMLElement;
      expect(card.textContent).toContain('SELL');
      expect(card.textContent).toContain('20');
      expect(card.textContent).toContain('TCS');
      expect(card.textContent).toContain('Reduces concentration');
      expect(card.querySelector('.chat-side-sell')).not.toBeNull();
    });

    it('opens the order form pre-filled, closes the panel, and places nothing', async () => {
      setUp();
      await open();
      store.messages.set([{ role: 'assistant', text: 'Consider this.', suggestions: [suggestion] }]);
      await settle();

      q('chat-open-order')?.click();
      await settle();

      expect(router.url).toBe('/app/orders?symbol=TCS&side=SELL&quantity=20');
      expect(q('chat-panel')).toBeNull();
      http.expectNone(() => true); // no order, no request of any kind
    });

    it('builds the link from the suggestion alone', () => {
      expect(orderLink(suggestion)).toEqual({ symbol: 'TCS', side: 'SELL', quantity: 20 });
    });
  });

  describe('problems', () => {
    it('shows the reason a question failed and puts the question back in the box', async () => {
      setUp();
      await open();
      await type('Will this work?');
      q('chat-send')?.click();
      await settle();

      http.expectOne(URL).flush({ errorCode: 'CHT-503', message: 'x' }, { status: 503, statusText: 'Unavailable' });
      await settle();

      expect(q('chat-error')?.textContent).toContain('unavailable');
      expect((q<HTMLTextAreaElement>('chat-input') as HTMLTextAreaElement).value).toBe('Will this work?');
      expect(all('chat-message').length).toBe(0);
    });

    it('starts a new conversation with the reset button', async () => {
      setUp();
      await open();
      store.messages.set([{ role: 'user', text: 'Hi', suggestions: [] }]);
      await settle();
      expect(all('chat-message').length).toBe(1);

      q('chat-clear')?.click();
      await settle();

      expect(all('chat-message').length).toBe(0);
      expect(all('chat-starter').length).toBe(3);
    });
  });

  it('is honest about what it is: not advice, and that a third party processes the questions', async () => {
    setUp();
    await open();

    const text = (q('chat-panel') as HTMLElement).textContent ?? '';
    expect(text).toContain('not financial advice');
    expect(text).toContain('third-party AI service');
    expect(text).toContain('never place one myself');
  });
});
