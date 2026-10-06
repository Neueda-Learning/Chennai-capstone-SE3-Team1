package com.team1.trading.api.chat;

import java.util.List;

public record ChatResponse(String reply, List<OrderSuggestion> suggestions) {
}
