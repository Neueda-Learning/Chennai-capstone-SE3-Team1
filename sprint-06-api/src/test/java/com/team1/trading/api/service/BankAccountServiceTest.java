package com.team1.trading.api.service;

import com.team1.trading.api.exception.InvalidAmountException;
import com.team1.trading.api.exception.TransferException;
import com.team1.trading.api.exception.TransferException.Reason;
import com.team1.trading.api.mapper.BankAccountMapper;
import com.team1.trading.domain.entity.BankAccount;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class BankAccountServiceTest {

    private static final String ACCOUNT = "IN45HDFC0000001234567";

    @Mock
    private BankAccountMapper bankAccountMapper;

    @InjectMocks
    private BankAccountService service;

    private static BankAccount account() {
        return new BankAccount(1L, ACCOUNT, "Aarav Mehta",
                new BigDecimal("100.00"), "HDFC Bank", "HDFC0001234");
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-5", "10.005"})
    void a_deposit_of_a_non_positive_or_sub_cent_amount_is_val_422(String amount) {
        assertThatThrownBy(() -> service.deposit(ACCOUNT, new BigDecimal(amount)))
                .isInstanceOf(InvalidAmountException.class)
                .hasFieldOrPropertyWithValue("code", "VAL-422");
        verifyNoInteractions(bankAccountMapper);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-5", "10.005"})
    void a_withdrawal_of_a_non_positive_or_sub_cent_amount_is_val_422(String amount) {
        assertThatThrownBy(() -> service.withdraw(ACCOUNT, new BigDecimal(amount)))
                .isInstanceOf(InvalidAmountException.class);
        verifyNoInteractions(bankAccountMapper);
    }

    @Test
    void a_deposit_adds_in_one_statement() {
        given(bankAccountMapper.credit(ACCOUNT, new BigDecimal("10.00"))).willReturn(1);

        assertThat(service.deposit(ACCOUNT, new BigDecimal("10"))).isTrue();
    }

    @Test
    void a_deposit_to_an_unknown_account_is_false() {
        given(bankAccountMapper.credit(anyString(), any())).willReturn(0);

        assertThat(service.deposit("NOSUCH", new BigDecimal("10"))).isFalse();
    }

    @Test
    void a_covered_withdrawal_succeeds() {
        given(bankAccountMapper.findByAccountNumber(ACCOUNT)).willReturn(Optional.of(account()));
        given(bankAccountMapper.debitIfCovered(ACCOUNT, new BigDecimal("40.00"))).willReturn(1);

        assertThat(service.withdraw(ACCOUNT, new BigDecimal("40"))).isTrue();
    }

    @Test
    void a_withdrawal_the_balance_cannot_cover_is_trf_400() {
        given(bankAccountMapper.findByAccountNumber(ACCOUNT)).willReturn(Optional.of(account()));
        given(bankAccountMapper.debitIfCovered(ACCOUNT, new BigDecimal("100.01"))).willReturn(0);

        assertThatThrownBy(() -> service.withdraw(ACCOUNT, new BigDecimal("100.01")))
                .isInstanceOf(TransferException.class)
                .hasFieldOrPropertyWithValue("code", "TRF-400")
                .hasFieldOrPropertyWithValue("reason", Reason.INSUFFICIENT_FUNDS);
    }

    @Test
    void a_withdrawal_from_an_unknown_account_is_false() {
        given(bankAccountMapper.findByAccountNumber("NOSUCH")).willReturn(Optional.empty());

        assertThat(service.withdraw("NOSUCH", new BigDecimal("10"))).isFalse();
        verify(bankAccountMapper, never()).debitIfCovered(anyString(), any());
    }
}
