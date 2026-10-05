package com.team1.executor.poller;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PollingScheduleTest {

    @Test
    void aBatchOfUpToTwentyFiveSymbolsCostsOneRequest() {
        assertThat(PollingSchedule.requestsPerPoll(1)).isEqualTo(1);
        assertThat(PollingSchedule.requestsPerPoll(8)).isEqualTo(1);
        assertThat(PollingSchedule.requestsPerPoll(25)).isEqualTo(1);
    }

    @Test
    void theTwentySixthSymbolCostsASecondRequest() {
        assertThat(PollingSchedule.requestsPerPoll(26)).isEqualTo(2);
        assertThat(PollingSchedule.requestsPerPoll(50)).isEqualTo(2);
        assertThat(PollingSchedule.requestsPerPoll(51)).isEqualTo(3);
    }

    @Test
    void nothingHeldCostsNothing() {
        assertThat(PollingSchedule.requestsPerPoll(0)).isZero();
    }

    @Test
    void ourConfiguredIntervalStaysInsideTheDailyQuotaForOurSymbolSet() {
        assertThat(PollingSchedule.requestsPerDay(4, 60)).isEqualTo(1440);
        assertThat(PollingSchedule.withinDailyBudget(4, 60)).isTrue();
        assertThat(PollingSchedule.requestsPerDay(4, 60)).isLessThan(PollingSchedule.DAILY_QUOTA);
    }

    @Test
    void theIntervalsThatDoNotFitAreTheOnesTheNotesWarnAbout() {
        assertThat(PollingSchedule.requestsPerDay(4, 30)).isEqualTo(2880);
        assertThat(PollingSchedule.withinDailyBudget(4, 30)).isFalse();

        assertThat(PollingSchedule.requestsPerDay(4, 15)).isEqualTo(5760);
        assertThat(PollingSchedule.withinDailyBudget(4, 15)).isFalse();
    }

    @Test
    void batchingIsWhatMakesTheIntervalAffordable() {
        int unbatched = 8 * PollingSchedule.requestsPerDay(1, 30);
        assertThat(unbatched).isEqualTo(23_040);

        assertThat(PollingSchedule.requestsPerDay(8, 30)).isEqualTo(2880);
        assertThat(PollingSchedule.requestsPerDay(8, 60)).isEqualTo(1440);
    }

    @Test
    void theFloorIsTheFastestIntervalThatFitsAndIsDerivedNotPicked() {
        assertThat(PollingSchedule.absoluteFloorSeconds()).isEqualTo(58);
        assertThat(PollingSchedule.withinDailyBudget(25, 58)).isTrue();
        assertThat(PollingSchedule.withinDailyBudget(25, 57)).isFalse();
    }

    @Test
    void theFloorRisesWithTheSymbolCountBecauseMoreSymbolsMeanMoreBatches() {
        assertThat(PollingSchedule.floorSeconds(25)).isEqualTo(58);
        assertThat(PollingSchedule.floorSeconds(26)).isEqualTo(116);
        assertThat(PollingSchedule.withinDailyBudget(26, PollingSchedule.floorSeconds(26))).isTrue();
    }

    @Test
    void enforceFloorRaisesAnUnaffordableIntervalAndLeavesAnAffordableOneAlone() {
        assertThat(PollingSchedule.enforceFloor(5)).isEqualTo(58);
        assertThat(PollingSchedule.enforceFloor(30)).isEqualTo(58);
        assertThat(PollingSchedule.enforceFloor(58)).isEqualTo(58);
        assertThat(PollingSchedule.enforceFloor(60)).isEqualTo(60);
        assertThat(PollingSchedule.enforceFloor(120)).isEqualTo(120);
    }

    @Test
    void aNonPositiveIntervalIsRejectedRatherThanDividedBy() {
        assertThatThrownBy(() -> PollingSchedule.requestsPerDay(4, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void theBudgetSplitAddsUpToTheWholeKey() {
        assertThat(PollingSchedule.POLLER_DAILY_BUDGET + PollingSchedule.FILL_PATH_RESERVE)
                .isEqualTo(PollingSchedule.DAILY_QUOTA);
    }
}
