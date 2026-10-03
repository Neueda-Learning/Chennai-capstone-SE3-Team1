import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing-page.html',
  styleUrls: ['./landing-page.css']
})
export class LandingPage {
  private readonly document = inject(DOCUMENT);
  // afterNextRender is called from event handlers, which are outside the injection
  // context, so it needs the injector handed to it explicitly.
  private readonly injector = inject(Injector);
  private readonly drawerClose = viewChild<ElementRef<HTMLButtonElement>>('drawerClose');
  private readonly detailsTrigger = viewChild<ElementRef<HTMLButtonElement>>('detailsTrigger');

  /**
   * The page shows one line per feature; the drawer carries the paragraph. Both read the same
   * record, so the summary on the page can never drift from the detail beside it.
   */
  readonly features = [
    {
      icon: 'bi-lightning-charge-fill',
      title: 'Real-Time Trading',
      blurb: 'Orders go in at the live market price, with no typed price to fat-finger.',
      detail:
        'Place a buy or sell from the market screen and it is carried to the execution service over the event bus. The blotter streams status changes back, so a fill does not depend on you refreshing anything. Positions, cash, and pending orders all move together.'
    },
    {
      icon: 'bi-graph-up',
      title: 'Portfolio Analytics',
      blurb: 'Holdings, cost, and unrealised P&L valued against the current market.',
      detail:
        'Every holding is revalued on the same quote poll the market screen uses, so the total you see is one number rather than four that disagree. Cost, invested value, unrealised P&L, and cash are broken out separately, and intraday positions are listed underneath rather than folded into the total.'
    },
    {
      icon: 'bi-shield-check',
      title: 'Secure & Reliable',
      blurb: 'Short-lived access tokens, refresh rotation, and a revocable session.',
      detail:
        'Signing in returns an access token and a refresh token. The access token is short-lived and sent as a bearer header; the refresh token is exchanged for a new pair and rotated on every use. Signing out revokes the refresh token server-side, so a copy of it is not a standing key.'
    },
    {
      icon: 'bi-activity',
      title: 'Advanced Monitoring',
      blurb: 'Order and wallet notifications pushed to the bell without a refresh.',
      detail:
        'The executor publishes order and transfer events; the API records them against the account; the shell polls that feed and raises a toast plus a badge count. Read state is remembered per browser, so the count reflects what you have not looked at rather than everything that has happened.'
    },
    {
      icon: 'bi-gear-fill',
      title: 'Smart Tools',
      blurb: 'Candles with SMA, EMA, Bollinger, RSI and MACD, over 1H to 1Y.',
      detail:
        'The chart draws main, volume, RSI, and MACD panes over a shared time axis, with overlays toggled independently. Your pane and overlay choices are remembered per browser, so the chart opens the way you left it. Indicators are computed in the browser from the candle series the API returns.'
    },
    {
      icon: 'bi-people-fill',
      title: 'Funded From Your Bank',
      blurb: 'Link an account once, then fund the trading wallet from it.',
      detail:
        'Linking a bank account creates the trading account the rest of the app trades against, so it is a one-time step rather than a per-screen field. Transfers between the bank and the wallet are recorded and show up in notifications and the account view.'
    }
  ];

  readonly highlights = [
    'Lightning-fast order execution',
    'Comprehensive portfolio management',
    'Advanced charting and analytics',
    'Mobile-first responsive design'
  ];

  /** Shown on the page so the hero is not claiming a screen count it cannot back up. */
  readonly heroStats = [
    { value: 'Live', label: 'Market data' },
    { value: '1m', label: 'Quote refresh' },
    { value: '4', label: 'Chart panes' }
  ];

  protected readonly detailsOpen = signal(false);
  protected readonly detailsTitle = computed(() =>
    this.detailsOpen() ? 'Platform details' : 'Details'
  );

  constructor() {
    // The scroll lock is the only part that can be done from a signal effect.
    effect(() => {
      this.document.body.classList.toggle('landing-drawer-open', this.detailsOpen());
    });
  }

  protected toggleDetails(): void {
    if (this.detailsOpen()) {
      this.closeDetails();
      return;
    }
    this.detailsOpen.set(true);
    // Focus has to wait for the render that adds `.show`. Until then the drawer is still
    // `visibility: hidden`, and a hidden element cannot take focus - asking earlier is a
    // silent no-op, which leaves a keyboard user tabbing through the page behind the drawer.
    afterNextRender(() => this.drawerClose()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeDetails(): void {
    if (!this.detailsOpen()) {
      return;
    }
    this.detailsOpen.set(false);
    // Hand focus back to the control that opened it rather than dropping it on <body>.
    afterNextRender(() => this.detailsTrigger()?.nativeElement.focus(), { injector: this.injector });
  }

  protected onEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.detailsOpen()) {
      this.closeDetails();
    }
  }

  scrollToSection(sectionId: string) {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
