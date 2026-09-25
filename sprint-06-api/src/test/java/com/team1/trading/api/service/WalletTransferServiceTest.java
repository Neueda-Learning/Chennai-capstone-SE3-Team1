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
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.AccountNotFoundException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class WalletTransferServiceTest {

    private static final Long ACCOUNT_ID = 7L;
    private static final String ACCOUNT_NUMBER = "IN45HDFC0000009999999";
    private static final String KEY = "6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e";

    @Mock
    private AccountMapper accountMapper;
    @Mock
    private WalletTransferMapper transferMapper;

    @InjectMocks
    private WalletTransferService service;

    private static AccountRow account(String state, String accountNumber) {
        AccountRow row = new AccountRow();
        row.setClientId(ACCOUNT_ID);
        row.setAccountNumber(accountNumber);
        row.setName("Priya Menon");
        row.setCreatedOn(LocalDateTime.of(2026, 9, 1, 9, 0));
        row.setAccountState(state);
        row.setWalletBalance(new BigDecimal("100.00"));
        row.setVersion(0);
        return row;
    }

    private static TransferRequest request(TransferDirection direction, String amount) {
        return new TransferRequest(direction, new BigDecimal(amount), KEY);
    }

    private void activeAccount() {
        given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(account("ACTIVE", ACCOUNT_NUMBER)));
    }

    @Test
    void bank_to_wallet_debits_the_bank_then_credits_the_wallet_and_records_the_transfer() {
        activeAccount();
        given(transferMapper.debitBank(ACCOUNT_NUMBER, new BigDecimal("250.00"))).willReturn(1);
        given(transferMapper.walletBalance(ACCOUNT_ID)).willReturn(new BigDecimal("350.00"));
        given(transferMapper.bankBalance(ACCOUNT_NUMBER)).willReturn(new BigDecimal("750.00"));

        TransferResponse response = service.transfer(ACCOUNT_ID, ACCOUNT_ID,
                request(TransferDirection.BANK_TO_WALLET, "250"));

        InOrder order = inOrder(transferMapper);
        ArgumentCaptor<TransferRow> row = ArgumentCaptor.forClass(TransferRow.class);
        order.verify(transferMapper).insert(row.capture());
        order.verify(transferMapper).debitBank(ACCOUNT_NUMBER, new BigDecimal("250.00"));
        order.verify(transferMapper).creditWallet(ACCOUNT_ID, new BigDecimal("250.00"));
        verify(transferMapper, never()).debitWallet(anyLong(), any());

        assertThat(row.getValue().getClientId()).isEqualTo(ACCOUNT_ID);
        assertThat(row.getValue().getAccountNumber()).isEqualTo(ACCOUNT_NUMBER);
        assertThat(row.getValue().getDirection()).isEqualTo("BANK_TO_WALLET");
        assertThat(row.getValue().getIdempotencyKey()).isEqualTo(KEY);

        assertThat(response.getTransferId()).isEqualTo(row.getValue().getTransferId());
        assertThat(response.getAmount()).isEqualByComparingTo("250.00");
        assertThat(response.getWalletBalance()).isEqualByComparingTo("350.00");
        assertThat(response.getBankBalance()).isEqualByComparingTo("750.00");
    }

    @Test
    void wallet_to_bank_debits_the_wallet_then_credits_the_bank() {
        activeAccount();
        given(transferMapper.debitWallet(ACCOUNT_ID, new BigDecimal("40.50"))).willReturn(1);

        service.transfer(ACCOUNT_ID, ACCOUNT_ID, request(TransferDirection.WALLET_TO_BANK, "40.5"));

        InOrder order = inOrder(transferMapper);
        order.verify(transferMapper).insert(any());
        order.verify(transferMapper).debitWallet(ACCOUNT_ID, new BigDecimal("40.50"));
        order.verify(transferMapper).creditBank(ACCOUNT_NUMBER, new BigDecimal("40.50"));
        verify(transferMapper, never()).debitBank(anyString(), any());
    }

    @Test
    void a_bank_that_cannot_cover_the_amount_is_trf_400_and_credits_nothing() {
        activeAccount();
        given(transferMapper.debitBank(ACCOUNT_NUMBER, new BigDecimal("1000000.00"))).willReturn(0);

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, ACCOUNT_ID,
                request(TransferDirection.BANK_TO_WALLET, "1000000")))
                .isInstanceOf(TransferException.class)
                .hasFieldOrPropertyWithValue("code", "TRF-400")
                .hasFieldOrPropertyWithValue("reason", Reason.INSUFFICIENT_FUNDS)
                .hasMessage("Insufficient funds");
        verify(transferMapper, never()).creditWallet(anyLong(), any());
    }

    @Test
    void a_wallet_that_cannot_cover_the_amount_is_trf_400_and_credits_nothing() {
        activeAccount();
        given(transferMapper.debitWallet(ACCOUNT_ID, new BigDecimal("100.01"))).willReturn(0);

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, ACCOUNT_ID,
                request(TransferDirection.WALLET_TO_BANK, "100.01")))
                .isInstanceOf(TransferException.class)
                .hasFieldOrPropertyWithValue("reason", Reason.INSUFFICIENT_FUNDS);
        verify(transferMapper, never()).creditBank(anyString(), any());
    }

    @Test
    void a_reused_idempotency_key_is_trf_409_before_any_money_moves() {
        activeAccount();
        willThrow(new DuplicateKeyException("uq_wallet_transfers_idempotency_key"))
                .given(transferMapper).insert(any());

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, ACCOUNT_ID,
                request(TransferDirection.BANK_TO_WALLET, "10")))
                .isInstanceOf(TransferException.class)
                .hasFieldOrPropertyWithValue("code", "TRF-409")
                .hasFieldOrPropertyWithValue("reason", Reason.DUPLICATE_TRANSFER);
        verify(transferMapper, never()).debitBank(anyString(), any());
        verify(transferMapper, never()).creditWallet(anyLong(), any());
    }

    @Test
    void a_token_for_another_account_is_acc_403() {
        activeAccount();

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, 5L, request(TransferDirection.BANK_TO_WALLET, "10")))
                .isInstanceOf(AccountNotActiveException.class);
        verify(transferMapper, never()).insert(any());
    }

    @Test
    void a_token_with_no_linked_account_is_acc_403() {
        activeAccount();

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, null, request(TransferDirection.BANK_TO_WALLET, "10")))
                .isInstanceOf(AccountNotActiveException.class);
        verify(transferMapper, never()).insert(any());
    }

    @Test
    void a_suspended_account_cannot_move_money() {
        given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(account("SUSPENDED", ACCOUNT_NUMBER)));

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, ACCOUNT_ID, request(TransferDirection.WALLET_TO_BANK, "10")))
                .isInstanceOf(AccountNotActiveException.class);
        verify(transferMapper, never()).insert(any());
    }

    @Test
    void an_unknown_account_is_acc_404() {
        given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, ACCOUNT_ID, request(TransferDirection.BANK_TO_WALLET, "10")))
                .isInstanceOf(AccountNotFoundException.class);
    }

    @Test
    void a_client_with_no_linked_bank_account_is_acc_404() {
        given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(account("ACTIVE", null)));

        assertThatThrownBy(() -> service.transfer(ACCOUNT_ID, ACCOUNT_ID, request(TransferDirection.BANK_TO_WALLET, "10")))
                .isInstanceOf(AccountNotFoundException.class);
        verify(transferMapper, never()).insert(any());
    }
}
