package com.team1.trading.api.conditional;

import com.team1.trading.api.conditional.ConditionRules.Condition;
import com.team1.trading.api.conditional.ConditionRules.Evaluation;
import com.team1.trading.api.conditional.ConditionalOrderMapper.LatestQuote;
import com.team1.trading.api.conditional.ConditionalOrderMapper.PendingRow;
import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.mapper.MarketQuoteMapper;
import com.team1.trading.domain.entity.types.ConditionType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * One pass over the PENDING orders (ADR 0012). Run every minute by {@link ConditionalOrderPoller}.
 *
 * Orders are grouped by symbol so each symbol's quotes are read once per pass. A symbol whose latest quote
 * is flagged stale, or older than {@code conditional-orders.max-quote-age}, is not judged at all: a
 * condition is never met on a price the market is not currently showing.
 */
@Component
public class ConditionalOrderChecker {

    private static final Logger log = LoggerFactory.getLogger(ConditionalOrderChecker.class);

    private final ConditionalOrderMapper mapper;
    private final MarketQuoteMapper quotes;
    private final ConditionalOrderReleaser releaser;
    private final Duration maxQuoteAge;
    private final boolean releaseEnabled;
    private final Clock clock;

    @Autowired
    public ConditionalOrderChecker(ConditionalOrderMapper mapper, MarketQuoteMapper quotes,
                                   ConditionalOrderReleaser releaser,
                                   @Value("${conditional-orders.max-quote-age:PT10M}") Duration maxQuoteAge,
                                   @Value("${conditional-orders.release.enabled:true}") boolean releaseEnabled) {
        this(mapper, quotes, releaser, maxQuoteAge, releaseEnabled, Clock.systemDefaultZone());
    }

    ConditionalOrderChecker(ConditionalOrderMapper mapper, MarketQuoteMapper quotes, ConditionalOrderReleaser releaser,
                            Duration maxQuoteAge, boolean releaseEnabled, Clock clock) {
        this.mapper = mapper;
        this.quotes = quotes;
        this.releaser = releaser;
        this.maxQuoteAge = maxQuoteAge;
        this.releaseEnabled = releaseEnabled;
        this.clock = clock;
    }

    public record Pass(int checked, int released, int expired, int skippedNoQuote) {
    }

    public Pass checkAll() {
        LocalDateTime now = LocalDateTime.now(clock);
        Map<String, List<PendingRow>> bySymbol = new LinkedHashMap<>();
        for (PendingRow row : mapper.findPending()) {
            bySymbol.computeIfAbsent(row.getSymbol(), s -> new java.util.ArrayList<>()).add(row);
        }

        int checked = 0;
        int released = 0;
        int expired = 0;
        int skipped = 0;
        for (Map.Entry<String, List<PendingRow>> entry : bySymbol.entrySet()) {
            List<PendingRow> orders = entry.getValue();
            for (PendingRow order : List.copyOf(orders)) {
                if (order.getExpiresAt() != null && !order.getExpiresAt().isAfter(now) && releaser.expire(order)) {
                    expired++;
                    orders.remove(order);
                    log.info("[conditional] order {} expired unmet", order.getOrderUuid());
                }
            }
            if (orders.isEmpty()) {
                continue;
            }
            Optional<List<BigDecimal>> prices = prices(entry.getKey(), orders, now);
            if (prices.isEmpty()) {
                skipped += orders.size();
                continue;
            }
            for (PendingRow order : orders) {
                checked++;
                if (checkOne(order, prices.get(), now)) {
                    released++;
                }
            }
        }
        if (checked + expired > 0) {
            log.info("[conditional] pass: checked={} released={} expired={} waitingForQuotes={}",
                    checked, released, expired, skipped);
        }
        return new Pass(checked, released, expired, skipped);
    }

    /** Evaluates one order against its symbol's prices; records the state and releases it if met. */
    boolean checkOne(PendingRow order, List<BigDecimal> prices, LocalDateTime now) {
        Evaluation evaluation = ConditionRules.evaluate(condition(order), prices, order.getConditionState());
        if (evaluation.met() && releaseEnabled) {
            if (releaser.release(order, evaluation.reason(), now)) {
                log.info("[conditional] released order {} ({} {} {}): {}", order.getOrderUuid(), order.getSide(),
                        order.getQuantity(), order.getSymbol(), evaluation.reason());
                return true;
            }
            return false;
        }
        mapper.markChecked(order.getOrderUuid(), evaluation.state(), now);
        return false;
    }

    /** The quotes the most demanding order on this symbol needs, oldest first, or empty if the latest is not live. */
    private Optional<List<BigDecimal>> prices(String symbol, List<PendingRow> orders, LocalDateTime now) {
        Optional<LatestQuote> latest = mapper.latestQuote(symbol);
        if (latest.isEmpty() || latest.get().getPrice() == null || latest.get().isStale()
                || latest.get().getReceivedAt() == null
                || latest.get().getReceivedAt().isBefore(now.minus(maxQuoteAge))) {
            return Optional.empty();
        }
        int needed = orders.stream().mapToInt(o -> ConditionRules.quotesNeeded(condition(o))).max().orElse(1);
        List<BigDecimal> history = quotes.history(symbol, needed).stream()
                .map(MarketPoint::getPrice).filter(p -> p != null && p.signum() > 0).toList();
        return history.isEmpty() ? Optional.empty() : Optional.of(history);
    }

    static Condition condition(PendingRow order) {
        return new Condition(ConditionType.valueOf(order.getConditionType()), order.getTriggerPrice(),
                order.getShortWindow(), order.getLongWindow(), order.getBandWidth());
    }
}
