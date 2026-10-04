package com.team1.trading.domain.entity;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BankAccountTest {

    @Test
    void a_bank_account_can_exist_before_anyone_claims_it() {
        BankAccount unclaimed = new BankAccount(null, "IN45HDFC0000007890123",
                new BigDecimal("150000.00"), "HDFC Bank", "HDFC0007890");

        assertNull(unclaimed.getClientId());
        assertFalse(unclaimed.isClaimed());
        assertEquals(0, new BigDecimal("150000.00").compareTo(unclaimed.getBalance()));
    }

    @Test
    void a_bank_account_with_a_client_is_claimed() {
        BankAccount claimed = new BankAccount(1L, "IN45HDFC0000001234567",
                "HDFC Bank", "HDFC0001234");

        assertTrue(claimed.isClaimed());
    }

    @Test
    void the_account_number_is_still_required() {
        assertThrows(NullPointerException.class,
                () -> new BankAccount(null, null, "Bank", "HDFC0000001"));
    }
}
