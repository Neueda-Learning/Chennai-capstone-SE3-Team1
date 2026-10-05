package com.team1.executor.quote;

import com.team1.executor.poller.PollingSchedule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;

/**
 * The one place that counts what has been spent against the Fauxnance key.
 *
 * <p>Two callers share a single 2000-request day: the market-data poller and the fill path. The
 * reason they live in one process is precisely so that they can share one counter — two processes
 * holding the same credential, each spending correctly and neither able to see the other's spend,
 * is how a key dies before lunch with nobody at fault.
 *
 * <p>{@link FauxnanceQuoteClient} records every request it makes, including each retry attempt,
 * so this is a count of requests actually issued rather than of calls intended. The poller asks
 * {@link #pollerMaySpend(int)} before it calls and skips the cycle when the answer is no. The
 * fill path is never blocked: it records and proceeds, because an order rejected for want of a
 * price is worse than a missing quote tick.
 */
@Component
public class QuotaLedger {

    private static final Logger log = LoggerFactory.getLogger(QuotaLedger.class);

    private final Clock clock;

    private LocalDate day;
    private int spent;

    public QuotaLedger() {
        this(Clock.systemUTC());
    }

    QuotaLedger(Clock clock) {
        this.clock = clock;
        this.day = LocalDate.now(clock);
    }

    /** Records one request issued by {@code caller}. */
    public synchronized void record(String caller) {
        record(caller, 1);
    }

    public synchronized void record(String caller, int requests) {
        rollOver();
        spent += requests;
        if (spent > PollingSchedule.DAILY_QUOTA) {
            log.warn("Fauxnance quota exhausted: {} requests spent today against a quota of {}. "
                            + "Expect 429s until 00:00 UTC. Last caller: {}",
                    spent, PollingSchedule.DAILY_QUOTA, caller);
        }
    }

    public synchronized int spentToday() {
        rollOver();
        return spent;
    }

    public synchronized int remainingToday() {
        rollOver();
        return Math.max(PollingSchedule.DAILY_QUOTA - spent, 0);
    }

    /**
     * Whether the poller may issue {@code requests} more requests without eating into the reserve
     * the fill path depends on.
     */
    public synchronized boolean pollerMaySpend(int requests) {
        rollOver();
        return spent + requests <= PollingSchedule.POLLER_DAILY_BUDGET;
    }

    private void rollOver() {
        LocalDate today = LocalDate.now(clock);
        if (!today.equals(day)) {
            log.info("Fauxnance quota reset for {}: {} requests were spent on {}", today, spent, day);
            day = today;
            spent = 0;
        }
    }
}
