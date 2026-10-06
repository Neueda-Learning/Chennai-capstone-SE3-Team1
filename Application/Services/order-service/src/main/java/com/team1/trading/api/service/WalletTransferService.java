package com.team1.trading.api.service;

import com.team1.trading.api.dto.TransferDirection;
import com.team1.trading.api.dto.TransferRequest;
import com.team1.trading.api.dto.TransferResponse;
import com.team1.trading.api.exception.TransferException;
import com.team1.trading.api.exception.TransferException.Reason;
import com.team1.trading.api.mapper.AccountMapper;
import com.team1.trading.api.mapper.AccountMapper.AccountRow;
import com.team1.trading.api.mapper.WalletTransferMapper;
import com.team1.trading.api.mapper.WalletTransferMapper.TransferRow;
import com.team1.trading.api.notifications.TransferNotifier;
import com.team1.trading.domain.entity.Client;
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.AccountNotFoundException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class WalletTransferService {

    private final AccountMapper accountMapper;
    private final WalletTransferMapper transferMapper;
    private final TransferNotifier notifier;

    public WalletTransferService(AccountMapper accountMapper, WalletTransferMapper transferMapper,
                                 TransferNotifier notifier) {
        this.accountMapper = accountMapper;
        this.transferMapper = transferMapper;
        this.notifier = notifier;
    }

    @Transactional
    public TransferResponse transfer(Long accountId, Long tokenAccountId, TransferRequest request) {
        AccountRow row = accountMapper.findRow(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
        if (tokenAccountId == null || !tokenAccountId.equals(accountId)) {
            throw new AccountNotActiveException(accountId, "TOKEN");
        }
        Client client = new Client(row.getClientId(), row.getName(),
                row.getCreatedOn(), row.getAccountState(), row.getWalletBalance());
        if (!client.canTrade()) {
            throw new AccountNotActiveException(accountId, client.getAccountState());
        }
        String accountNumber = row.getAccountNumber();
        if (accountNumber == null) {
            throw new AccountNotFoundException(accountId);
        }

        BigDecimal amount = request.getAmount().setScale(2, RoundingMode.UNNECESSARY);
        TransferDirection direction = request.getDirection();
        TransferRow transfer = new TransferRow(UUID.randomUUID().toString(), accountId, accountNumber,
                direction.name(), amount, request.getIdempotencyKey(), LocalDateTime.now());
        try {
            transferMapper.insert(transfer);
        } catch (DuplicateKeyException e) {
            throw new TransferException(Reason.DUPLICATE_TRANSFER, accountId,
                    "idempotencyKey=" + request.getIdempotencyKey());
        }

        if (direction == TransferDirection.BANK_TO_WALLET) {
            if (transferMapper.debitBank(accountNumber, amount) == 0) {
                throw new TransferException(Reason.INSUFFICIENT_FUNDS, accountId,
                        "bank balance cannot cover " + amount);
            }
            transferMapper.creditWallet(accountId, amount);
        } else {
            if (transferMapper.debitWallet(accountId, amount) == 0) {
                throw new TransferException(Reason.INSUFFICIENT_FUNDS, accountId,
                        "wallet balance cannot cover " + amount);
            }
            transferMapper.creditBank(accountNumber, amount);
        }

        notifier.transferCompleted(transfer.getTransferId(), accountId, direction, amount);

        return new TransferResponse(transfer.getTransferId(), accountId, direction, amount,
                transferMapper.walletBalance(accountId), transferMapper.bankBalance(accountNumber),
                transfer.getCreatedAt());
    }
}
