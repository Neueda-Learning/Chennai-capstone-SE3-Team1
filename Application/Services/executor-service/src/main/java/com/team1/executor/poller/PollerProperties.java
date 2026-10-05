package com.team1.executor.poller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component("pollerProperties")
public class PollerProperties {

    private static final Logger log = LoggerFactory.getLogger(PollerProperties.class);

    private final int configuredIntervalSeconds;
    private final int effectiveIntervalSeconds;

    public PollerProperties(@Value("${executor.poll-interval-seconds}") int configuredIntervalSeconds) {
        this.configuredIntervalSeconds = configuredIntervalSeconds;
        this.effectiveIntervalSeconds = PollingSchedule.enforceFloor(configuredIntervalSeconds);

        if (effectiveIntervalSeconds != configuredIntervalSeconds) {
            log.warn("executor.poll-interval-seconds={} is below the {}s floor and has been clamped. "
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

    public long getEffectiveIntervalMillis() {
        return effectiveIntervalSeconds * 1000L;
    }
}
