import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NotificationStore } from '../../core/notifications/notification.store';
import { type ThemeName, ThemeService } from '../../core/theme/theme.service';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  function create() {
    const themeState = signal<ThemeName>('light');
    const popupsState = signal(true);
    const themeStub = {
      theme: themeState.asReadonly(),
      set: vi.fn((value: ThemeName) => themeState.set(value))
    } as unknown as ThemeService;
    const notificationsStub = {
      popupsEnabled: popupsState.asReadonly(),
      setPopupsEnabled: vi.fn((enabled: boolean) => popupsState.set(enabled))
    } as unknown as NotificationStore;

    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        { provide: ThemeService, useValue: themeStub },
        { provide: NotificationStore, useValue: notificationsStub }
      ]
    });

    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();

    return { fixture, themeState, popupsState, themeStub, notificationsStub };
  }

  it('switches the theme and the notification pop-up preference', () => {
    const { fixture, themeState, popupsState, themeStub, notificationsStub } = create();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="theme-light"]')?.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('[data-testid="theme-dark"]')?.getAttribute('aria-checked')).toBe('false');

    root.querySelector<HTMLButtonElement>('[data-testid="theme-dark"]')!.click();
    fixture.detectChanges();

    expect(themeStub.set).toHaveBeenCalledWith('dark');
    expect(themeState()).toBe('dark');
    expect(root.querySelector('[data-testid="theme-dark"]')?.getAttribute('aria-checked')).toBe('true');

    const toggle = root.querySelector<HTMLInputElement>('[data-testid="popups-toggle"]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(notificationsStub.setPopupsEnabled).toHaveBeenCalledWith(false);
    expect(popupsState()).toBe(false);
    expect(toggle.checked).toBe(false);
  });
});