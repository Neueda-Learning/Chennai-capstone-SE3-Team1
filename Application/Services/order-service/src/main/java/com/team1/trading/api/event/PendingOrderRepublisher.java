package com.team1.trading.api.event;

import com.team1.trading.api.mapper.OrderMapper;
import com.team1.trading.api.mapper.OrderMapper.OrderRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Sends {@code ORDER_PLACED} again for every order still sitting at {@code NEW}, once at startup.
 *
 * <p>The event is published after the order's transaction commits (see
 * {@link KafkaOrderEventPublisher}), so an order can be committed and never published: Kafka or
 * this service was down at that moment. Nothing else ever sends it, and the row stays at
 * {@code NEW} forever. This is the recovery the publisher's own notes promise ("replayed from the
 * order table").
 *
 * <p>Re-sending is safe. The executor treats an order that is no longer {@code NEW} as already
 * settled and publishes nothing for it, and claims a {@code NEW} one with a guarded delete, so a
 * duplicate message costs one log line, never a second fill.
 *
 * <p>The replay runs on its own thread: with the broker down a send blocks until the producer
 * gives up, and startup must not wait on that. Orders that could not be sent are retried a few
 * times, since the broker is as likely to be coming up alongside this service as before it.
 */
@Component
@ConditionalOnProperty(name = "orders.republish-on-startup", havingValue = "true", matchIfMissing = true)
public class PendingOrderRepublisher {

    private static final Logger log = LoggerFactory.getLogger(PendingOrderRepublisher.class);

    private final OrderMapper orderMapper;
    private final KafkaOrderEventPublisher publisher;
    private final int maxAttempts;
    private final long retryDelayMs;
    private final long sendTimeoutMs;

    public PendingOrderRepublisher(OrderMapper orderMapper,
                                   KafkaOrderEventPublisher publisher,
                                   @Value("${orders.republish.max-attempts:10}") int maxAttempts,
                                   @Value("${orders.republish.retry-delay-ms:30000}") long retryDelayMs,
                                   @Value("${orders.republish.send-timeout-ms:15000}") long sendTimeoutMs) {
        this.orderMapper = orderMapper;
        this.publisher = publisher;
        this.maxAttempts = maxAttempts;
        this.retryDelayMs = retryDelayMs;
        this.sendTimeoutMs = sendTimeoutMs;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        Thread worker = new Thread(this::republishPending, "pending-order-republisher");
        worker.setDaemon(true);
        worker.start();
    }

    /** One pass per attempt over what is still pending; returns the number of orders left unsent. */
    void republishPending() {
        Set<String> sent = new HashSet<>();
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            int unsent = republishOnce(sent);
            if (unsent == 0) {
                return;
            }
            if (attempt == maxAttempts) {
                log.error("{} pending order(s) could not be re-published after {} attempt(s); "
                        + "they stay NEW until this service is restarted", unsent, maxAttempts);
                return;
            }
            try {
                Thread.sleep(retryDelayMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    int republishOnce(Set<String> sent) {
        List<OrderRow> pending;
        try {
            pending = orderMapper.findNew().stream()
                    .filter(row -> !sent.contains(row.getOrderUuid()))
                    .toList();
        } catch (RuntimeException e) {
            log.error("Could not read pending orders to re-publish", e);
            return 1;
        }
        if (pending.isEmpty()) {
            log.info("No pending orders left to re-publish");
            return 0;
        }

        log.info("Re-publishing {} pending order(s) to the orders topic", pending.size());
        List<OrderRow> failed = new ArrayList<>();
        for (OrderRow row : pending) {
            if (send(row)) {
                sent.add(row.getOrderUuid());
            } else {
                failed.add(row);
            }
        }
        log.info("Re-published {} of {} pending order(s)", pending.size() - failed.size(), pending.size());
        return failed.size();
    }

    private boolean send(OrderRow row) {
        try {
            OrderPlacedEvent event = OrderPlacedEvent.of(row.getOrderUuid(), row.getAccountId(),
                    row.getSymbol(), row.getSide(), row.getQuantity(), row.getPrice(),
                    row.getIdempotencyKey(), row.getCreatedAt());
            publisher.send(event).get(sendTimeoutMs, TimeUnit.MILLISECONDS);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception e) {
            log.warn("Could not re-publish order {}: {}", row.getOrderUuid(), e.toString());
            return false;
        }
    }
}
