package com.team1.trading.api.market;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.trading.api.mapper.CandleMapper.DailyCandleWrite;
import com.team1.trading.api.market.FauxnanceCandleClient.CandleFetchException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FauxnanceCandleClientParseTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String s) {
        try {
            return MAPPER.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("Parses the data.candles array, keyed by the bare ticker")
    void parses() {
        List<DailyCandleWrite> out = FauxnanceCandleClient.parse("INFY", json("""
                {"data":{"symbol":"INFY.NS","interval":"1d","currency":"INR","candles":[
                  {"date":"2026-07-01","open":1584.5,"high":1601.2,"low":1580.05,"close":1598.7,"adjclose":1598.7,"volume":7412300,"synthetic":false},
                  {"date":"2026-07-02","open":1599.0,"high":1604.85,"low":1588.4,"close":1591.25,"adjclose":1591.25,"volume":null,"synthetic":true}
                ]},"meta":{}}"""));

        assertThat(out).hasSize(2);
        assertThat(out.get(0).getSymbol()).isEqualTo("INFY");
        assertThat(out.get(0).getTradeDate()).isEqualTo(LocalDate.of(2026, 7, 1));
        assertThat(out.get(0).getClose()).isEqualByComparingTo("1598.7");
        assertThat(out.get(0).getVolume()).isEqualTo(7_412_300L);
        assertThat(out.get(1).getVolume()).isNull();
        assertThat(out.get(1).isSynthetic()).isTrue();
    }

    @Test
    @DisplayName("Skips a bad row and keeps the rest")
    void skipsBadRows() {
        List<DailyCandleWrite> out = FauxnanceCandleClient.parse("INFY", json("""
                {"data":{"candles":[
                  {"date":"2026-07-01","open":10,"high":11,"low":9,"close":10},
                  {"date":"2026-07-02","open":10,"high":11,"low":9},
                  {"date":"2026-07-03","open":10,"high":11,"low":9,"close":"n/a"},
                  {"date":"2026-07-04","open":10,"high":8,"low":9,"close":10},
                  {"date":"09/07/2026","open":10,"high":11,"low":9,"close":10},
                  {"date":"2026-07-06","open":10,"high":11,"low":9,"close":-1},
                  {"date":"2026-07-07","open":10,"high":11,"low":9,"close":10}
                ]}}"""));

        assertThat(out).extracting(DailyCandleWrite::getTradeDate)
                .containsExactly(LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 7));
    }

    @Test
    @DisplayName("A body with no candles array is a failed fetch, not an empty chart")
    void unrecognised() {
        assertThatThrownBy(() -> FauxnanceCandleClient.parse("INFY", json("{\"data\":{}}")))
                .isInstanceOf(CandleFetchException.class);
        assertThatThrownBy(() -> FauxnanceCandleClient.parse("INFY", null))
                .isInstanceOf(CandleFetchException.class);
    }
}
