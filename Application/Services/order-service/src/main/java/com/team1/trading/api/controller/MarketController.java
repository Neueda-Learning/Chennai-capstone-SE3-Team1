package com.team1.trading.api.controller;

import com.team1.trading.api.dto.CandleResponse;
import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.market.CandleService;
import com.team1.trading.api.service.MarketService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/market")
public class MarketController {

    private final MarketService marketService;
    private final CandleService candleService;

    public MarketController(MarketService marketService, CandleService candleService) {
        this.marketService = marketService;
        this.candleService = candleService;
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

    @GetMapping("/quotes/{symbol}/candles")
    public ResponseEntity<List<CandleResponse>> candles(@PathVariable("symbol") String symbol,
                                                        @RequestParam(value = "interval", defaultValue = "5m") String interval,
                                                        @RequestParam(value = "range", defaultValue = "1d") String range) {
        return ResponseEntity.ok(candleService.candles(symbol, interval, range));
    }
}
