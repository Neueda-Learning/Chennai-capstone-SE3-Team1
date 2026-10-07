package com.team1.trading.api.advice;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * When the daily analysis is checked: once as soon as the service is up, then every 15 minutes. Each check is
 * cheap (one ledger read) and only the first one after the cutoff on a new day actually runs the ETL.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "etl.daily.enabled", havingValue = "true", matchIfMissing = true)
public class DailyAnalysisScheduling {

    private final DailyAnalysisJob job;

    public DailyAnalysisScheduling(DailyAnalysisJob job) {
        this.job = job;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        job.trigger("startup");
    }

    @Scheduled(fixedDelayString = "${etl.daily.check-interval-ms:900000}",
            initialDelayString = "${etl.daily.check-interval-ms:900000}")
    public void check() {
        job.trigger("schedule");
    }
}
