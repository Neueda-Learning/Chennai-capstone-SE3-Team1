package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.team1.trading.api.chat.ChatTools.ChatContext;
import com.team1.trading.api.chat.LlmClient.LlmResult;
import com.team1.trading.api.chat.LlmClient.ToolCall;
import com.team1.trading.api.chat.LlmClient.ToolResult;
import com.team1.trading.api.chat.LlmClient.Turn;
import com.team1.trading.api.service.AccountService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

@Service
public class ChatService {

    /** Rounds of "model asks for data, we answer" allowed before it must give an answer. */
    static final int MAX_TOOL_ROUNDS = 5;
    static final String GAVE_UP = "I couldn't pull together a complete answer just now. Please try asking again, "
            + "or ask about one thing at a time.";
    /** Sent once if the model stops after using tools without writing anything for the customer. */
    static final String WRITE_ANSWER = "Now write your answer to the customer, using what you found.";
    private static final ZoneId MARKET_ZONE = ZoneId.of("Asia/Kolkata");

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private final LlmClient llm;
    private final ChatTools tools;
    private final AccountService accounts;
    private final ChatRateLimiter limiter;
    private final String currency;

    public ChatService(LlmClient llm, ChatTools tools, AccountService accounts, ChatRateLimiter limiter,
                       @Value("${trade.currency:INR}") String currency) {
        this.llm = llm;
        this.tools = tools;
        this.accounts = accounts;
        this.limiter = limiter;
        this.currency = currency;
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.trim();
    }

    public ChatResponse chat(long accountId, Long tokenAccountId, List<ChatRequest.Message> messages) {
        // Ownership first, before any quota or model spend: the same check every account route makes.
        accounts.getBalance(accountId, tokenAccountId);
        limiter.acquire(accountId);

        long started = System.currentTimeMillis();
        List<Turn> turns = new ArrayList<>();
        for (ChatRequest.Message message : messages) {
            turns.add("user".equals(message.getRole())
                    ? new Turn.User(message.getText())
                    : new Turn.Model(message.getText(), List.of(), null));
        }

        ChatContext context = new ChatContext(accountId, tokenAccountId, new ArrayList<>());
        String system = SystemPrompt.build(LocalDate.now(MARKET_ZONE), currency);
        List<String> used = new ArrayList<>();

        String reply = GAVE_UP;
        for (int round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            LlmResult result = llm.generate(system, turns, tools.specs());
            if (result.calls().isEmpty()) {
                String text = blankToNull(result.text());
                if (text == null && !used.isEmpty()) {
                    // It gathered what it needed and then said nothing. Ask once more, with no tools on offer,
                    // so the only thing it can do is write the answer.
                    turns.add(new Turn.User(WRITE_ANSWER));
                    text = blankToNull(llm.generate(system, turns, List.of()).text());
                }
                reply = text == null ? GAVE_UP : text;
                break;
            }
            if (round == MAX_TOOL_ROUNDS) {
                break;
            }
            List<ToolResult> results = new ArrayList<>();
            for (ToolCall call : result.calls()) {
                used.add(call.name());
                JsonNode output = tools.execute(call.name(), call.args(), context);
                results.add(new ToolResult(call.id(), call.name(), output));
            }
            turns.add(new Turn.Model(result.text(), result.calls(), result.raw()));
            turns.add(new Turn.ToolResults(results));
        }

        // An audit line, not a transcript: who, how much, which tools, what was suggested. No message
        // text and no portfolio data is logged.
        log.info("[chat] account={} messages={} tools={} suggestions={} ms={}", accountId, messages.size(), used,
                context.suggestions().stream().map(s -> s.side() + " " + s.quantity() + " " + s.symbol()).toList(),
                System.currentTimeMillis() - started);
        return new ChatResponse(reply, List.copyOf(context.suggestions()));
    }
}
