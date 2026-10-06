import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionStore } from '../../core/auth/session.store';
import { NotificationHistoryEntry } from '../../core/services/notification-history.service';
import { provideApi } from '../../generated/trade-client';
import { NotificationHistoryCard } from './notification-history-card';

const URL = 'http://trade.test/api/v1/accounts/42/notification-history';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';

function entry(n: number, overrides: Partial<NotificationHistoryEntry> = {}): NotificationHistoryEntry {
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    kind: 'ORDER_FILLED',
    message: `Your BUY order for ${n} TCS was filled at 3501.25.`,
    channel: 'EMAIL',
    status: 'SENT',
    createdAt: `2026-10-06T10:00:${String(60 - n).padStart(2, '0')}Z`,
    deliveredAt: '2026-10-06T10:01:00Z',
    ...overrides
  };
}

describe('NotificationHistoryCard', () => {
  let http: HttpTestingController;

  function setUp(): ComponentFixture<NotificationHistoryCard> {
    TestBed.configureTestingModule({
      imports: [NotificationHistoryCard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotificationHistoryCard);
    fixture.detectChanges();
    return fixture;
  }

  function all(fixture: ComponentFixture<NotificationHistoryCard>, testId: string): HTMLElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  }

  afterEach(() => {
    http?.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('asks for the signed-in account only, one page at a time', () => {
    setUp();

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.has('before')).toBe(false);
    request.flush([]);
  });

  it('shows every message with how it was delivered, including held and failed ones', () => {
    const fixture = setUp();
    http.expectOne((r) => r.url === URL).flush([
      entry(1),
      entry(2, { channel: null, status: 'PENDING_CHANNEL', deliveredAt: null }),
      entry(3, { status: 'FAILED', deliveredAt: null }),
      entry(4, { channel: 'EMAIL', status: 'QUEUED', deliveredAt: null })
    ]);
    fixture.detectChanges();

    const statuses = all(fixture, 'history-status').map((node) => node.textContent?.trim());
    expect(statuses).toEqual([
      'Sent by email',
      'Waiting for a channel preference',
      'Could not be delivered',
      'Sending by email'
    ]);
    expect(all(fixture, 'history-message')[0].textContent).toContain('BUY order for 1 TCS');
    expect(all(fixture, 'history-more')).toHaveLength(0);
  });

  it('says so when there are no messages yet', () => {
    const fixture = setUp();
    http.expectOne((r) => r.url === URL).flush([]);
    fixture.detectChanges();

    expect(all(fixture, 'history-empty')).toHaveLength(1);
  });

  it('loads older messages with the createdAt of the last one as the cursor', () => {
    const fixture = setUp();
    const firstPage = Array.from({ length: 20 }, (_, i) => entry(i + 1));
    http.expectOne((r) => r.url === URL).flush(firstPage);
    fixture.detectChanges();

    all(fixture, 'history-more')[0].click();
    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.get('before')).toBe(firstPage[19].createdAt);
    request.flush([entry(21)]);
    fixture.detectChanges();

    expect(all(fixture, 'history-message')).toHaveLength(21);
    expect(all(fixture, 'history-more')).toHaveLength(0);
  });

  it('explains a failure in plain words', () => {
    const fixture = setUp();
    http
      .expectOne((r) => r.url === URL)
      .flush({ errorCode: 'ACC-403', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(all(fixture, 'history-error')).toHaveLength(1);
    expect(all(fixture, 'history-message')).toHaveLength(0);
  });
});
