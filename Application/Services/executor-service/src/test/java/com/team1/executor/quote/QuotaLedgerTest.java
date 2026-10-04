package com.team1.executor.quote;

import com.team1.executor.poller.PollingSchedule;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * One counter, two callers. The reason the poller lives inside the executor rather than in a
 * container of its own is that these two spends have to be visible to each other.
 */
class QuotaLedgerTest {

    private static final Instant WEDNESDAY_LATE = Instant.parse("2026-09-17T23:59:00Z");
    private static final Instant THURSDAY_EARLY = Instant.parse("2026-09-18T00:00:30Z");

    private static final class MutableClock extends Clock {
        private Instant now;

        private MutableClock(Instant now) {
            this.now = now;
        }

        private void moveTo(Instant next) {
            this.now = next;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    void bothCallersSpendFromTheSameCounter() {
        QuotaLedger ledger = new QuotaLedger(new MutableClock(WEDNESDAY_LATE));

        ledger.record("market-poller", 10);
        ledger.record("fill-path");
        ledger.record("fill-path");

        assertThat(ledger.spentToday()).isEqualTo(12);
        assertThat(ledger.remainingToday()).isEqualTo(PollingSchedule.DAILY_QUOTA - 12);
    }

    @Test
    void thePollerIsRefusedOnceItHasSpentItsBudget() {
        QuotaLedger ledger = new QuotaLedger(new MutableClock(WEDNESDAY_LATE));

        ledger.record("market-poller", PollingSchedule.POLLER_DAILY_BUDGET);

        assertThat(ledger.pollerMaySpend(1)).isFalse();
        assertThat(ledger.remainingToday()).isEqualTo(PollingSchedule.FILL_PATH_RESERVE);
    }

    @Test
    void thePollerIsAllowedRightUpToTheBudgetAndNotPastIt() {
        QuotaLedger ledger = new QuotaLedger(new MutableClock(WEDNESDAY_LATE));

        ledger.record("market-poller", PollingSchedule.POLLER_DAILY_BUDGET - 1);

        assertThat(ledger.pollerMaySpend(1)).isTrue();
        assertThat(ledger.pollerMaySpend(2)).isFalse();
    }

    @Test
    void theFillPathIsNeverBlockedByTheLedger() {
        QuotaLedger ledger = new QuotaLedger(new MutableClock(WEDNESDAY_LATE));

        ledger.record("market-poller", PollingSchedule.POLLER_DAILY_BUDGET);
        ledger.record("fill-path");

        // The ledger counts the fill path, it does not gate it: an order rejected for want of a
        // price is a worse outcome than a missing quote tick.
        assertThat(ledger.spentToday()).isEqualTo(PollingSchedule.POLLER_DAILY_BUDGET + 1);
    }

    @Test
    void theCounterResetsAtMidnightUtcRatherThanAfterTwentyFourHours() {
        MutableClock clock = new MutableClock(WEDNESDAY_LATE);
        QuotaLedger ledger = new QuotaLedger(clock);

        ledger.record("market-poller", PollingSchedule.POLLER_DAILY_BUDGET);
        assertThat(ledger.pollerMaySpend(1)).isFalse();

        clock.moveTo(THURSDAY_EARLY);

        assertThat(ledger.spentToday()).isZero();
        assertThat(ledger.pollerMaySpend(1)).isTrue();
        assertThat(ledger.remainingToday()).isEqualTo(PollingSchedule.DAILY_QUOTA);
    }

    @Test
    void remainingNeverGoesNegativeWhenTheQuotaIsOverspent() {
        QuotaLedger ledger = new QuotaLedger(new MutableClock(WEDNESDAY_LATE));

        ledger.record("fill-path", PollingSchedule.DAILY_QUOTA + 50);

        assertThat(ledger.remainingToday()).isZero();
    }
}
