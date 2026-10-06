package com.team1.trading.api.notifications;

import com.team1.trading.api.dto.TransferDirection;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Records and sends the notification for a wallet transfer.
 *
 * Runs only after the transfer's own transaction has committed, so a transfer that rolls back never
 * announces itself, and a notification problem can never undo or fail a transfer: this class swallows
 * its own failures (a transfer notice is lost, the money still moved). The work happens on its own
 * thread: code run inside afterCommit still shares the finished transaction's connection, so an insert
 * made there would never be committed, and the transfer response should not wait on a database write
 * it does not need.
 */
@Component
public class TransferNotifier {

    static final String EVENT_PREFIX = "transfer-";

    private static final Logger log = LoggerFactory.getLogger(TransferNotifier.class);

    private final NotificationRecorder recorder;
    private final NotificationDispatcher dispatcher;
    private final String currency;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "transfer-notifier");
        thread.setDaemon(true);
        return thread;
    });

    public TransferNotifier(NotificationRecorder recorder, NotificationDispatcher dispatcher,
                            @Value("${trade.currency:INR}") String currency) {
        this.recorder = recorder;
        this.dispatcher = dispatcher;
        this.currency = currency;
    }

    public void transferCompleted(String transferId, long accountId, TransferDirection direction, BigDecimal amount) {
        Runnable notify = () -> notifyNow(transferId, accountId, direction, amount);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        worker.execute(notify);
                    } catch (RejectedExecutionException shuttingDown) {
                        log.warn("Transfer {} completed but its notification was not queued: shutting down", transferId);
                    }
                }
            });
        } else {
            notify.run();
        }
    }

    @PreDestroy
    void stop() {
        worker.shutdown();
    }

    void notifyNow(String transferId, long accountId, TransferDirection direction, BigDecimal amount) {
        try {
            boolean intoWallet = direction == TransferDirection.BANK_TO_WALLET;
            NotificationKind kind = intoWallet ? NotificationKind.TRANSFER_IN : NotificationKind.TRANSFER_OUT;
            NotificationRecorder.Recorded recorded = recorder.record(EVENT_PREFIX + transferId, accountId, kind,
                    MessageComposer.transferPayload(intoWallet, amount, currency));
            if (recorded.created() && recorded.status() == NotificationStatus.QUEUED) {
                dispatcher.dispatchSoon();
            }
        } catch (RuntimeException e) {
            log.warn("Transfer {} completed but its notification could not be recorded", transferId, e);
        }
    }
}
