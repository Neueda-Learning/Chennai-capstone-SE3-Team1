package com.team1.executor.quote;

import com.team1.executor.poller.PollingSchedule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;

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
