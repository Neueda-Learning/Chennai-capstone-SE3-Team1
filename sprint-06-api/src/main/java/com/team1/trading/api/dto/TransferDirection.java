package com.team1.trading.api.dto;

/**
 * Which way a transfer moves money. The wallet is the trading balance; the bank account is only
 * where money is fed in from and paid out to.
 */
public enum TransferDirection {
    /** Fund the wallet from the linked bank account. */
    BANK_TO_WALLET,
    /** Pay out from the wallet to the linked bank account. */
    WALLET_TO_BANK
}
