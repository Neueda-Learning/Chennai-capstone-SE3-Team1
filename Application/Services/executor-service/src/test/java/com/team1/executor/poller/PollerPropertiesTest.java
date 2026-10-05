package com.team1.executor.poller;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The interval floor is enforced in the code, not documented and hoped for. These tests are the
 * difference between the two.
 */
class PollerPropertiesTest {

    @Test
    void anIntervalBelowTheFloorIsClampedToTheFloor() {
        PollerProperties properties = new PollerProperties(5);

        assertThat(properties.configuredIntervalSeconds()).isEqualTo(5);
        assertThat(properties.effectiveIntervalSeconds()).isEqualTo(58);
        assertThat(properties.getEffectiveIntervalMillis()).isEqualTo(58_000L);
    }

    @Test
    void thirtySecondsIsClampedToo() {
        // 30s is the interval the notes warn about: it survives an afternoon and not a night.
        assertThat(new PollerProperties(30).effectiveIntervalSeconds()).isEqualTo(58);
    }

    @Test
    void ourConfiguredIntervalIsLeftAlone() {
        PollerProperties properties = new PollerProperties(60);

        assertThat(properties.configuredIntervalSeconds()).isEqualTo(60);
        assertThat(properties.effectiveIntervalSeconds()).isEqualTo(60);
        assertThat(properties.getEffectiveIntervalMillis()).isEqualTo(60_000L);
    }

    @Test
    void aSlowerIntervalIsLeftAloneBecauseTheFloorIsAFloorAndNotATarget() {
        assertThat(new PollerProperties(300).effectiveIntervalSeconds()).isEqualTo(300);
    }

    @Test
    void anAbsurdIntervalCannotProduceAnAbsurdSchedule() {
        assertThat(new PollerProperties(0).effectiveIntervalSeconds()).isEqualTo(58);
        assertThat(new PollerProperties(-1).effectiveIntervalSeconds()).isEqualTo(58);
    }

    @Test
    void whateverIsConfiguredTheEffectiveIntervalFitsTheBudget() {
        for (int configured : new int[]{-1, 0, 1, 5, 15, 30, 57, 58, 60, 120}) {
            int effective = new PollerProperties(configured).effectiveIntervalSeconds();
            assertThat(PollingSchedule.withinDailyBudget(25, effective))
                    .as("POLL_INTERVAL_SECONDS=%d gives %ds, which must fit the poller budget",
                            configured, effective)
                    .isTrue();
        }
    }
}
