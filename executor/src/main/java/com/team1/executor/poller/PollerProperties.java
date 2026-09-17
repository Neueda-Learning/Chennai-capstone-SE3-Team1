package com.team1.executor.poller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Reads {@code POLL_INTERVAL_SECONDS} and enforces the floor on it.
 *
 * <p>The floor is enforced here rather than documented somewhere and hoped for. A README saying
 * "do not go below 58 seconds" does not survive somebody tuning an env var at 2am to make a demo
 * feel snappier, and the cost of that is a dead key for the whole team until 00:00 UTC.
 *
 * <p>We clamp rather than refuse to start. The poller is a passenger in the executor's process,
 * and a passenger must not be able to stop the fill path from consuming orders over a
 * misconfiguration whose safe resolution is unambiguous. The warning is loud and the effective
 * value is logged either way, so a clamp is visible at the top of the log rather than silent.
 */
@Component("pollerProperties")
public class PollerProperties {

    private static final Logger log = LoggerFactory.getLogger(PollerProperties.class);

    private final int configuredIntervalSeconds;
    private final int effectiveIntervalSeconds;

    public PollerProperties(@Value("${executor.poll-interval-seconds}") int configuredIntervalSeconds) {
        this.configuredIntervalSeconds = configuredIntervalSeconds;
        this.effectiveIntervalSeconds = PollingSchedule.enforceFloor(configuredIntervalSeconds);

        if (effectiveIntervalSeconds != configuredIntervalSeconds) {
            log.warn("POLL_INTERVAL_SECONDS={} is below the {}s floor and has been clamped. "
                            + "At {}s one batch would cost {} requests/day against a {} poller budget. Polling every {}s instead.",
                    configuredIntervalSeconds,
                    PollingSchedule.absoluteFloorSeconds(),
                    configuredIntervalSeconds,
                    configuredIntervalSeconds > 0
                            ? PollingSchedule.requestsPerDay(1, configuredIntervalSeconds)
                            : PollingSchedule.POLLER_DAILY_BUDGET,
                    PollingSchedule.POLLER_DAILY_BUDGET,
                    effectiveIntervalSeconds);
        } else {
            log.info("Market-data poller interval {}s, floor {}s. One batch at this interval is {} requests/day "
                            + "against a {} poller budget, with {} reserved for pricing fills.",
                    effectiveIntervalSeconds,
                    PollingSchedule.absoluteFloorSeconds(),
                    PollingSchedule.requestsPerDay(1, effectiveIntervalSeconds),
                    PollingSchedule.POLLER_DAILY_BUDGET,
                    PollingSchedule.FILL_PATH_RESERVE);
        }
    }

    public int configuredIntervalSeconds() {
        return configuredIntervalSeconds;
    }

    public int effectiveIntervalSeconds() {
        return effectiveIntervalSeconds;
    }

    /** Referenced by SpEL from {@code MarketDataPoller}'s {@code @Scheduled} annotation. */
    public long getEffectiveIntervalMillis() {
        return effectiveIntervalSeconds * 1000L;
    }
}
