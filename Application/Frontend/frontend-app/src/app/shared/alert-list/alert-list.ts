import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';

import { percentFrom } from '../../core/charts/price-axis';
import { formatMoney, formatSignedPercent } from '../../core/format/money';
import { AlertDeliveryState, PriceAlert } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';

const DELIVERY_TEXT: Record<AlertDeliveryState, string> = {
  QUEUED: 'Sent to your notifications',
  PENDING_CHANNEL: 'Waiting for you to choose a channel in Settings',
  REJECTED: 'Notifications refused it',
  DELIVERY_FAILED: 'Could not be handed to notifications'
};

/**
 * The customer's price alerts, with how far each stock now is from its level, and the controls to turn one off,
 * bring it back, or delete it. Armed alerts come first, since those are the ones still waiting.
 */
@Component({
  selector: 'tui-alert-list',
  imports: [DatePipe],
  templateUrl: './alert-list.html',
  styleUrl: './alert-list.css'
})
export class AlertList {
  readonly alerts = input.required<readonly PriceAlert[]>();
  /** Latest price per symbol, to show how far each alert is from triggering. */
  readonly prices = input<Readonly<Record<string, number | null>>>({});
  /** Show at most this many (the rest are counted); none means all. */
  readonly limit = input<number | null>(null);
  readonly compact = input(false);
  /** Emitted when a symbol is clicked, so a page can show that stock's chart. */
  readonly selectSymbol = output<string>();

  protected readonly store = inject(WatchlistStore);

  protected readonly formatMoney = formatMoney;
  protected readonly formatPercent = formatSignedPercent;

  private static readonly ORDER = { ARMED: 0, FIRED: 1, DISABLED: 2 } as const;

  protected readonly sorted = computed(() =>
    [...this.alerts()].sort((a, b) => AlertList.ORDER[a.state] - AlertList.ORDER[b.state])
  );
  protected readonly shown = computed(() => {
    const limit = this.limit();
    return limit === null ? this.sorted() : this.sorted().slice(0, limit);
  });
  protected readonly hidden = computed(() => this.sorted().length - this.shown().length);

  protected arrow(alert: PriceAlert): string {
    return alert.direction === 'ABOVE' ? '▲ ≥' : '▼ ≤';
  }

  protected directionText(alert: PriceAlert): string {
    return alert.direction === 'ABOVE' ? 'rises to or above' : 'falls to or below';
  }

  protected stateText(alert: PriceAlert): string {
    return { ARMED: 'Watching', FIRED: 'Triggered', DISABLED: 'Off' }[alert.state];
  }

  /** How far the current price is from the level, for alerts still waiting: "2.1% to go". */
  protected distance(alert: PriceAlert): string | null {
    if (alert.state !== 'ARMED') {
      return null;
    }
    const percent = percentFrom(alert.threshold, this.prices()[alert.symbol] ?? null);
    return percent === null ? null : `${Math.abs(percent).toFixed(1)}% to go`;
  }

  protected deliveryText(alert: PriceAlert): string | null {
    if (alert.state !== 'FIRED') {
      return null;
    }
    return alert.deliveryState === null ? 'Handing over to notifications' : DELIVERY_TEXT[alert.deliveryState];
  }

  protected toggle(alert: PriceAlert): void {
    this.store.setAlertState(alert.id, alert.state === 'ARMED' ? 'DISABLED' : 'ARMED').subscribe();
  }

  protected remove(alert: PriceAlert): void {
    this.store.deleteAlert(alert.id).subscribe();
  }
}
