package com.team1.trading.api.controller;

import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.service.MarketService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The polled market data under {@code /api/v1/market}. Needs a valid bearer token like every
 * other {@code /api/v1} route (the JWT filter covers the prefix), but the data is not specific
 * to any account, so there is no account check.
 */
@RestController
@RequestMapping("/api/v1/market")
public class MarketController {

    private final MarketService marketService;

    public MarketController(MarketService marketService) {
        this.marketService = marketService;
    }

    @GetMapping("/quotes")
    public ResponseEntity<List<MarketQuoteResponse>> quotes() {
        return ResponseEntity.ok(marketService.latestQuotes());
    }

    @GetMapping("/quotes/{symbol}/history")
    public ResponseEntity<List<MarketPoint>> history(@PathVariable("symbol") String symbol,
                                                     @RequestParam(value = "limit", required = false) Integer limit) {
        return ResponseEntity.ok(marketService.history(symbol, limit));
    }
}
