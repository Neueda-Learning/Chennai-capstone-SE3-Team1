package com.team1.trading.api.dto;

import java.util.List;

/**
 * An account's whole portfolio: both books, in one answer.
 *
 * <p>The platform keeps two, and they mean different things. {@code holdings} is delivery -
 * stock the account owns outright, so the quantity is never negative. {@code positions} is
 * the intraday book, where a short is a negative quantity and gains move the opposite way to
 * the price. Returning them separately keeps that distinction visible; flattening them into
 * one list would make a short look like a mistake.
 */
public class PortfolioResponse {

    private Long accountId;
    private List<PositionResponse> holdings;
    private List<PositionResponse> positions;

    public PortfolioResponse() {
    }

    public PortfolioResponse(Long accountId, List<PositionResponse> holdings,
                             List<PositionResponse> positions) {
        this.accountId = accountId;
        this.holdings = holdings;
        this.positions = positions;
    }

    public Long getAccountId() {
        return accountId;
    }

    public void setAccountId(Long accountId) {
        this.accountId = accountId;
    }

    public List<PositionResponse> getHoldings() {
        return holdings;
    }

    public void setHoldings(List<PositionResponse> holdings) {
        this.holdings = holdings;
    }

    public List<PositionResponse> getPositions() {
        return positions;
    }

    public void setPositions(List<PositionResponse> positions) {
        this.positions = positions;
    }
}
