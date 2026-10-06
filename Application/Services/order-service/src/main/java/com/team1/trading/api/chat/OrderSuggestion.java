package com.team1.trading.api.chat;

/** An order the assistant thinks the user should consider. Nothing is placed; the screen offers a pre-filled form. */
public record OrderSuggestion(String symbol, String side, int quantity, String reason) {
}
