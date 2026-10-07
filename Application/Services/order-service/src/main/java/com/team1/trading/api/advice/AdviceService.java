package com.team1.trading.api.advice;

import com.team1.trading.api.advice.AdviceViews.Advice;
import com.team1.trading.api.advice.AdviceViews.Ideas;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.dto.PositionResponse;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.api.watchlists.WatchedSymbols;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A customer's advice (ADR 0011): the ETL's published analysis and prediction for every instrument they hold
 * or watch, plus the market's strongest ideas for the dashboard. Holdings come through
 * {@link AccountService#getPortfolio}, watched symbols through {@link WatchedSymbols}. Nothing is computed
 * here and nothing is written; the numbers are the ETL job's.
 */
@Service
public class AdviceService {

    static final int IDEAS = 5;

    private final AccountService accounts;
    private final WatchedSymbols watched;
    private final MarketService market;
    private final AnalysisQueries analysis;

    public AdviceService(AccountService accounts, WatchedSymbols watched, MarketService market,
                         AnalysisQueries analysis) {
        this.accounts = accounts;
        this.watched = watched;
        this.market = market;
        this.analysis = analysis;
    }

    public Advice forAccount(long accountId) {
        Map<String, PositionResponse> holdings = holdings(accountId);
        List<String> watching = watched.symbolsWatchedBy(accountId);
        Map<String, Signal> published = analysis.all();
        Map<String, String> names = names();

        Set<String> symbols = new LinkedHashSet<>(holdings.keySet());
        symbols.addAll(watching);
        List<Signal> signals = new ArrayList<>();
        for (String symbol : symbols) {
            signals.add(personal(published.get(symbol), symbol, names.get(symbol), holdings.get(symbol),
                    watching.contains(symbol)));
        }

        LocalDate dataAsOf = published.values().stream().map(Signal::asOf).filter(d -> d != null)
                .max(Comparator.naturalOrder()).orElse(null);
        Ideas ideas = new Ideas(analysis.ranked("BUY", IDEAS), analysis.ranked("SELL", IDEAS));
        return new Advice(accountId, analysis.model().orElse(null),
                AnalysisQueries.METHODOLOGY, AnalysisQueries.DISCLAIMER, analysis.lastRun().orElse(null), dataAsOf,
                analysis.isStale(dataAsOf), signals, ideas);
    }

    public Signal forSymbol(long accountId, String rawSymbol) {
        String symbol = AnalysisQueries.normalise(rawSymbol);
        Map<String, String> names = names();
        if (!names.containsKey(symbol)) {
            throw new InstrumentNotFoundException(rawSymbol);
        }
        PositionResponse holding = holdings(accountId).get(symbol);
        boolean isWatched = watched.symbolsWatchedBy(accountId).contains(symbol);
        return personal(analysis.find(symbol).orElse(null), symbol, names.get(symbol), holding, isWatched);
    }

    private Signal personal(Signal published, String symbol, String name, PositionResponse holding, boolean isWatched) {
        Signal base = published == null ? analysis.unpublished(symbol, name) : published;
        List<SignalSource> sources = new ArrayList<>();
        if (holding != null) {
            sources.add(SignalSource.HOLDING);
        }
        if (isWatched) {
            sources.add(SignalSource.WATCHLIST);
        }
        return new Signal(base.symbol(), base.name() == null ? name : base.name(), sources,
                holding == null ? null : holding.getQuantity(), holding == null ? null : holding.getAverageCost(),
                base.status(), base.suggestion(), base.confidence(), base.score(), base.summary(), base.reasons(),
                base.indicators(), base.asOf(), base.stale(), base.prediction());
    }

    private Map<String, PositionResponse> holdings(long accountId) {
        Map<String, PositionResponse> bySymbol = new LinkedHashMap<>();
        List<PositionResponse> held = accounts.getPortfolio(accountId, accountId).getHoldings();
        if (held != null) {
            for (PositionResponse position : held) {
                if (position.getQuantity() != null && position.getQuantity() > 0) {
                    bySymbol.put(position.getSymbol(), position);
                }
            }
        }
        return bySymbol;
    }

    /** Active instruments and their names, from the market service. */
    private Map<String, String> names() {
        Map<String, String> names = new LinkedHashMap<>();
        for (MarketQuoteResponse quote : market.latestQuotes()) {
            names.put(quote.getSymbol(), quote.getName());
        }
        return names;
    }
}
