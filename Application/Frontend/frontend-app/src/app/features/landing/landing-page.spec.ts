import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LandingPage } from './landing-page';

describe('LandingPage', () => {
  async function setup() {
    const fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function el(fixture: ReturnType<typeof TestBed.createComponent<LandingPage>>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
  }

  const isOpen = (fixture: ReturnType<typeof TestBed.createComponent<LandingPage>>) =>
    el(fixture, 'details-drawer').classList.contains('show');

  async function open(fixture: ReturnType<typeof TestBed.createComponent<LandingPage>>) {
    el(fixture, 'details-open').click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingPage],
      providers: [provideRouter([])]
    }).compileComponents();
    document.body.className = '';
  });

  afterEach(() => {
    document.body.className = '';
  });

  it('starts with the drawer closed and off screen', async () => {
    const fixture = await setup();
    expect(isOpen(fixture)).toBe(false);
  });

  it('opens from the nav button and reports the state to assistive tech', async () => {
    const fixture = await setup();
    const trigger = el(fixture, 'details-open');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(isOpen(fixture)).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('locks page scrolling while open and releases it on close', async () => {
    const fixture = await setup();

    await open(fixture);
    expect(document.body.classList.contains('landing-drawer-open')).toBe(true);

    el(fixture, 'details-close').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.classList.contains('landing-drawer-open')).toBe(false);
  });

  it('closes on the close button, the backdrop, and Escape', async () => {
    const fixture = await setup();

    for (const testid of ['details-close', 'details-backdrop']) {
      await open(fixture);
      expect(isOpen(fixture)).toBe(true);

      el(fixture, testid).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(isOpen(fixture)).toBe(false);
    }

    await open(fixture);
    (fixture.nativeElement.querySelector('.landing-wrapper') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(isOpen(fixture)).toBe(false);
  });

  it('toggles closed when the same trigger is used again', async () => {
    const fixture = await setup();

    await open(fixture);
    el(fixture, 'details-open').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(isOpen(fixture)).toBe(false);
  });

  it('can also be opened from the features section', async () => {
    const fixture = await setup();

    el(fixture, 'details-open-features').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(isOpen(fixture)).toBe(true);
  });

  it('carries more detail than the one-line summary shown on the page', () => {
    const features = TestBed.createComponent(LandingPage).componentInstance.features;

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.blurb.length).toBeGreaterThan(0);
      expect(feature.detail.length).toBeGreaterThan(feature.blurb.length);
    }
  });

  it('renders a drawer entry per feature plus the highlights block', async () => {
    const fixture = await setup();
    const instance = fixture.componentInstance;

    expect(fixture.nativeElement.querySelectorAll('.drawer-item').length).toBe(
      instance.features.length + 1
    );
    expect(fixture.nativeElement.querySelectorAll('.drawer-highlights li').length).toBe(
      instance.highlights.length
    );
  });

  it('labels the drawer for assistive tech', async () => {
    const fixture = await setup();
    const drawer = el(fixture, 'details-drawer');
    const labelledBy = drawer.getAttribute('aria-labelledby');

    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(labelledBy).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`#${labelledBy}`)).toBeTruthy();
  });

  it('moves focus into the drawer and back out again', async () => {
    const fixture = await setup();
    const close = el(fixture, 'details-close');
    const trigger = el(fixture, 'details-open');

    await open(fixture);
    expect(document.activeElement).toBe(close);

    close.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
  });
});
