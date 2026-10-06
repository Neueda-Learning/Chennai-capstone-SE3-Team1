package com.team1.trading.api.chat;

import com.team1.trading.api.chat.ChatAction.AlertProposal;
import com.team1.trading.api.chat.ChatAction.NavigationLink;
import com.team1.trading.api.chat.ChatAction.WatchlistProposal;

import java.util.List;

public record ChatResponse(
        String reply,
        List<OrderSuggestion> suggestions,
        List<AlertProposal> alertProposals,
        List<WatchlistProposal> watchlistProposals,
        List<NavigationLink> links) {

    public ChatResponse(String reply, List<OrderSuggestion> suggestions) {
        this(reply, suggestions, List.of(), List.of(), List.of());
    }
}
