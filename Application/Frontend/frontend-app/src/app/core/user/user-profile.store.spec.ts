import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi as provideAuthApi } from '../../generated/auth-client';
import { provideApi as provideTradeApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { UserProfileStore } from './user-profile.store';

const USER = { id: 'u1', username: 'priya.menon', email: 'priya@example.com', phone: '9876543210', accountId: 5, roles: ['CUSTOMER'], status: 'ACTIVE' };
const ACCOUNT = { id: 5, accountId: 'ACC-5', holderName: 'Priya Menon', bankName: 'HDFC Bank', cashBalance: 1, status: 'ACTIVE', version: 0, lastUpdated: '' };

describe('UserProfileStore', () => {
  let http: HttpTestingController;
  let api: FakeApi;
  let store: UserProfileStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAuthApi({ basePath: 'http://auth.test' }),
        provideTradeApi({ basePath: 'http://trade.test' })
      ]
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(UserProfileStore);
    api = new FakeApi(http).get('/auth/me', USER).get('/accounts/5', ACCOUNT);
  });

  afterEach(() => http.verify());

  it('knows nothing before it is loaded', () => {
    expect(store.loaded()).toBe(false);
    expect(store.displayName()).toBeNull();
    expect(store.initials()).toBe('');
    expect(store.email()).toBeNull();
  });

  it('prefers the account holder name, and exposes the login details', () => {
    store.load(5);
    api.flush();

    expect(store.loaded()).toBe(true);
    expect(store.displayName()).toBe('Priya Menon');
    expect(store.username()).toBe('priya.menon');
    expect(store.email()).toBe('priya@example.com');
    expect(store.phone()).toBe('9876543210');
    expect(store.initials()).toBe('PM');
  });

  it('falls back to the username, and asks for no account, when none is linked', () => {
    store.load(null);
    api.flush();

    expect(store.displayName()).toBe('priya.menon');
    expect(store.initials()).toBe('PM'); // priya.menon splits on the dot
    expect(api.count('/accounts/')).toBe(0);
  });

  it('takes two letters of a single-word name', () => {
    api.set('/auth/me', { ...USER, username: 'trader1' });
    api.set('/accounts/5', { ...ACCOUNT, holderName: 'Aarav' });
    store.load(5);
    api.flush();

    expect(store.initials()).toBe('AA');
  });

  it('has no picture to show, so the avatar is a placeholder', () => {
    store.load(5);
    api.flush();

    expect(store.avatarUrl()).toBeNull();
  });

  it('keeps what it can when one of the two calls fails', () => {
    api.set('/accounts/5', { errorCode: 'X', message: 'down' }, 500);
    store.load(5);
    api.flush();

    expect(store.displayName()).toBe('priya.menon');
  });

  it('shows nothing when both fail', () => {
    api.set('/auth/me', { errorCode: 'X', message: 'down' }, 401);
    api.set('/accounts/5', { errorCode: 'X', message: 'down' }, 500);
    store.load(5);
    api.flush();

    expect(store.displayName()).toBeNull();
  });

  it('forgets the person on clear', () => {
    store.load(5);
    api.flush();

    store.clear();

    expect(store.loaded()).toBe(false);
    expect(store.displayName()).toBeNull();
  });
});
