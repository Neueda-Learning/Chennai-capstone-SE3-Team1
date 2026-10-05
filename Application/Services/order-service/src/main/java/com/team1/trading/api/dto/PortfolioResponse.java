package com.team1.trading.api.dto;

import java.util.List;

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
