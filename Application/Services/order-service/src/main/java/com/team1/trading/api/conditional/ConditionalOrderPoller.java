package com.team1.trading.api.conditional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** Checks every PENDING order once a minute (conditional-orders.poll-interval-ms). */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "conditional-orders.scheduler.enabled", havingValue = "true", matchIfMissing = true)
public class ConditionalOrderPoller {

    private static final Logger log = LoggerFactory.getLogger(ConditionalOrderPoller.class);

    private final ConditionalOrderChecker checker;

    public ConditionalOrderPoller(ConditionalOrderChecker checker) {
        this.checker = checker;
    }

    @Scheduled(fixedDelayString = "${conditional-orders.poll-interval-ms:60000}",
            initialDelayString = "${conditional-orders.poll-interval-ms:60000}")
    public void poll() {
        try {
            checker.checkAll();
        } catch (RuntimeException e) {
            log.error("[conditional] pass failed; the next one runs in a minute", e);
        }
    }
}
