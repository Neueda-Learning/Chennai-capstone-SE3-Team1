package com.team1.trading.api.dto;

import java.math.BigDecimal;

public class PositionResponse {

    private Long accountId;
    private String symbol;
    private Integer quantity;
    private BigDecimal averageCost;
    private BigDecimal overallGains;

    public PositionResponse() {
    }

    public PositionResponse(Long accountId, String symbol, Integer quantity, BigDecimal averageCost,
                            BigDecimal overallGains) {
        this.accountId = accountId;
        this.symbol = symbol;
        this.quantity = quantity;
        this.averageCost = averageCost;
        this.overallGains = overallGains;
    }

    public BigDecimal getOverallGains() {
        return overallGains;
    }

    public void setOverallGains(BigDecimal overallGains) {
        this.overallGains = overallGains;
    }

    public Long getAccountId() {
        return accountId;
    }

    public void setAccountId(Long accountId) {
        this.accountId = accountId;
    }

    public String getSymbol() {
        return symbol;
    }

    public void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    public Integer getQuantity() {
        return quantity;
    }

    public void setQuantity(Integer quantity) {
        this.quantity = quantity;
    }

    public BigDecimal getAverageCost() {
        return averageCost;
    }

    public void setAverageCost(BigDecimal averageCost) {
        this.averageCost = averageCost;
    }
}