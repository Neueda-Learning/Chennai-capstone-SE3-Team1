package com.team1.trading.api.conditional;

import com.team1.trading.api.conditional.ConditionRules.Condition;
import com.team1.trading.api.conditional.ConditionRules.Evaluation;
import com.team1.trading.domain.entity.types.ConditionType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ConditionRulesTest {

    private static final Condition AT_OR_ABOVE_3600 =
            new Condition(ConditionType.PRICE_AT_OR_ABOVE, new BigDecimal("3600"), null, null, null);
    private static final Condition AT_OR_BELOW_3500 =
            new Condition(ConditionType.PRICE_AT_OR_BELOW, new BigDecimal("3500"), null, null, null);
    private static final Condition CROSS_ABOVE = new Condition(ConditionType.MA_CROSS_ABOVE, null, 2, 4, null);
    private static final Condition CROSS_BELOW = new Condition(ConditionType.MA_CROSS_BELOW, null, 2, 4, null);
    private static final Condition BELOW_LOWER =
            new Condition(ConditionType.BOLLINGER_BELOW_LOWER, null, null, 4, new BigDecimal("1.0"));
    private static final Condition ABOVE_UPPER =
            new Condition(ConditionType.BOLLINGER_ABOVE_UPPER, null, null, 4, new BigDecimal("1.0"));

    private static List<BigDecimal> prices(String... values) {
        return Arrays.stream(values).map(BigDecimal::new).toList();
    }

    @Test
    @DisplayName("A price condition is met as soon as the latest price is at or past the trigger")
    void priceLevelMet() {
        Evaluation above = ConditionRules.evaluate(AT_OR_ABOVE_3600, prices("3590", "3600.00"), null);
        Evaluation below = ConditionRules.evaluate(AT_OR_BELOW_3500, prices("3499.95"), null);

        assertThat(above.met()).isTrue();
        assertThat(above.reason()).isEqualTo("Price 3600.00 reached 3600.00");
        assertThat(below.met()).isTrue();
        assertThat(below.reason()).contains("fell to 3500.00");
    }

    @Test
    @DisplayName("A price condition not yet reached is not met, and says how far the price is")
    void priceLevelNotMet() {
        Evaluation evaluation = ConditionRules.evaluate(AT_OR_ABOVE_3600, prices("3599.99"), null);

        assertThat(evaluation.met()).isFalse();
        assertThat(evaluation.ready()).isTrue();
        assertThat(evaluation.reason()).contains("is below 3600.00");
    }

    @Test
    @DisplayName("The first check of a crossover only records where the averages stand")
    void crossoverFirstCheckRecordsOnly() {
        Evaluation evaluation = ConditionRules.evaluate(CROSS_ABOVE, prices("10", "10", "12", "13"), null);

        assertThat(evaluation.met()).isFalse();
        assertThat(evaluation.state()).isEqualTo(ConditionRules.ABOVE);
    }

    @Test
    @DisplayName("A crossover is met when the state moves into the wanted side since the last check")
    void crossoverMetOnStateChange() {
        // short (12+13)/2 = 12.5 above long (10+10+12+13)/4 = 11.25; last check saw BELOW
        Evaluation evaluation = ConditionRules.evaluate(CROSS_ABOVE, prices("10", "10", "12", "13"),
                ConditionRules.BELOW);

        assertThat(evaluation.met()).isTrue();
        assertThat(evaluation.state()).isEqualTo(ConditionRules.ABOVE);
        assertThat(evaluation.reason()).isEqualTo("2-quote average 12.50 crossed above the 4-quote average 11.25");
    }

    @Test
    @DisplayName("A short window of 1 is the price itself crossing its average")
    void priceCrossesItsAverage() {
        Condition priceCross = new Condition(ConditionType.MA_CROSS_BELOW, null, 1, 4, null);
        // price 7 below the 4-quote average (10+10+10+7)/4 = 9.25; last check saw ABOVE
        Evaluation evaluation = ConditionRules.evaluate(priceCross, prices("10", "10", "10", "7"), ConditionRules.ABOVE);

        assertThat(evaluation.met()).isTrue();
        assertThat(evaluation.reason()).isEqualTo("Price 7.00 crossed below the 4-quote average 9.25");
        assertThat(ConditionText.describe(ConditionType.MA_CROSS_BELOW, null, 1, 4, null))
                .isEqualTo("when the price crosses below the 4-quote average");
    }

    @Test
    @DisplayName("No release while the averages stay on the same side, or cross the other way")
    void crossoverNotMet() {
        assertThat(ConditionRules.evaluate(CROSS_ABOVE, prices("10", "10", "12", "13"), ConditionRules.ABOVE).met())
                .isFalse();
        assertThat(ConditionRules.evaluate(CROSS_BELOW, prices("10", "10", "12", "13"), ConditionRules.BELOW).met())
                .isFalse();
    }

    @Test
    @DisplayName("Too few quotes decides nothing and keeps the stored state")
    void notEnoughQuotes() {
        Evaluation evaluation = ConditionRules.evaluate(CROSS_ABOVE, prices("10", "11"), ConditionRules.BELOW);

        assertThat(evaluation.ready()).isFalse();
        assertThat(evaluation.met()).isFalse();
        assertThat(evaluation.state()).isEqualTo(ConditionRules.BELOW);
        assertThat(evaluation.reason()).contains("2 of 4");
    }

    @Test
    @DisplayName("A band condition is met when the price leaves the band on the wanted side")
    void bandMet() {
        // window 11,10,11,8: mean 10, sd 1.22, lower 8.78; 8 is below
        Evaluation below = ConditionRules.evaluate(BELOW_LOWER, prices("11", "10", "11", "8"), ConditionRules.INSIDE);
        // window 11,10,11,14: mean 11.5, sd 1.5, upper 13; 14 is above
        Evaluation above = ConditionRules.evaluate(ABOVE_UPPER, prices("11", "10", "11", "14"), ConditionRules.INSIDE);

        assertThat(below.met()).isTrue();
        assertThat(below.reason()).isEqualTo("Price 8.00 fell below the lower band 8.78");
        assertThat(above.met()).isTrue();
        assertThat(above.reason()).contains("rose above the upper band 13.00");
    }

    @Test
    @DisplayName("No release inside the band, or while the price stays outside it")
    void bandNotMet() {
        Evaluation inside = ConditionRules.evaluate(BELOW_LOWER, prices("11", "10", "11", "10.5"), ConditionRules.INSIDE);
        Evaluation stillBelow = ConditionRules.evaluate(BELOW_LOWER, prices("11", "10", "11", "8"), ConditionRules.BELOW);

        assertThat(inside.met()).isFalse();
        assertThat(inside.state()).isEqualTo(ConditionRules.INSIDE);
        assertThat(stillBelow.met()).isFalse();
    }
}
