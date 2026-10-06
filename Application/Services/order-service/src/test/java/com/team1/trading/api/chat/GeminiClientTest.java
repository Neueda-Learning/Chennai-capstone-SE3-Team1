package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.team1.trading.api.chat.LlmClient.LlmResult;
import com.team1.trading.api.chat.LlmClient.ToolCall;
import com.team1.trading.api.chat.LlmClient.ToolResult;
import com.team1.trading.api.chat.LlmClient.ToolSpec;
import com.team1.trading.api.chat.LlmClient.Turn;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GeminiClientTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String KEY = "test-key-not-a-real-one";

    private HttpServer server;
    private final List<String> requests = new CopyOnWriteArrayList<>();           // "model" of each call, in order
    private final List<String> urls = new CopyOnWriteArrayList<>();
    private final List<String> keyHeaders = new CopyOnWriteArrayList<>();
    private final List<JsonNode> bodies = new CopyOnWriteArrayList<>();
    private final Map<String, List<Integer>> statusByModel = new ConcurrentHashMap<>();
    private String okBody = textReply("Hello there");

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1beta/models/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            String model = path.substring("/v1beta/models/".length(), path.indexOf(':'));
            requests.add(model);
            urls.add(exchange.getRequestURI().toString());
            keyHeaders.add(exchange.getRequestHeaders().getFirst("x-goog-api-key"));
            bodies.add(JSON.readTree(exchange.getRequestBody().readAllBytes()));

            List<Integer> script = statusByModel.getOrDefault(model, List.of(200));
            long previous = requests.stream().filter(model::equals).count() - 1;
            int status = script.get((int) Math.min(previous, script.size() - 1));
            byte[] body = (status == 200 ? okBody : "{\"error\":{\"message\":\"nope\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private GeminiClient client(String... models) {
        GeminiSettings settings = new GeminiSettings("http://127.0.0.1:" + server.getAddress().getPort() + "/v1beta",
                KEY, List.of(models), 5, "low");
        @SuppressWarnings("unchecked")
        ObjectProvider<GeminiSettings> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(settings);
        return new GeminiClient(provider);
    }

    private static String textReply(String text) {
        return "{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":" + quote(text) + "}]}}]}";
    }

    private static String quote(String s) {
        return "\"" + s.replace("\"", "\\\"") + "\"";
    }

    private static List<Turn> ask(String text) {
        return List.of(new Turn.User(text));
    }

    // ---- the happy path

    @Test
    @DisplayName("A reply's text is returned, and the key travels in a header, never in the URL")
    void textReplyAndKeyHandling() {
        LlmResult result = client("m1").generate("be helpful", ask("hi"), List.of());

        assertThat(result.text()).isEqualTo("Hello there");
        assertThat(result.calls()).isEmpty();
        assertThat(keyHeaders).containsExactly(KEY);
        assertThat(urls.get(0)).doesNotContain(KEY).doesNotContain("key=");
    }

    @Test
    @DisplayName("The request carries the system prompt, the conversation and the tool declarations")
    void requestShape() {
        ToolSpec tool = new ToolSpec("get_quote", "Price of a stock",
                JSON.createObjectNode().put("type", "OBJECT"));
        ((com.fasterxml.jackson.databind.node.ObjectNode) tool.parameters()).putObject("properties")
                .putObject("symbol").put("type", "STRING");

        client("m1").generate("SYSTEM TEXT", ask("hi"), List.of(tool));

        JsonNode body = bodies.get(0);
        assertThat(body.at("/systemInstruction/parts/0/text").asText()).isEqualTo("SYSTEM TEXT");
        assertThat(body.at("/contents/0/role").asText()).isEqualTo("user");
        assertThat(body.at("/contents/0/parts/0/text").asText()).isEqualTo("hi");
        assertThat(body.at("/tools/0/functionDeclarations/0/name").asText()).isEqualTo("get_quote");
        assertThat(body.at("/tools/0/functionDeclarations/0/parameters/properties/symbol/type").asText()).isEqualTo("STRING");
    }

    @Test
    @DisplayName("A tool with no arguments is declared without a parameters block, which the API would reject")
    void emptySchemaOmitted() {
        ToolSpec none = new ToolSpec("get_market_overview", "All quotes",
                JSON.createObjectNode().put("type", "OBJECT"));
        ((com.fasterxml.jackson.databind.node.ObjectNode) none.parameters()).putObject("properties");

        client("m1").generate("s", ask("hi"), List.of(none));

        assertThat(bodies.get(0).at("/tools/0/functionDeclarations/0").has("parameters")).isFalse();
    }

    // ---- thinking level

    @Test
    @DisplayName("The configured thinking level is sent with the request")
    void thinkingLevelSent() {
        client("m1").generate("s", ask("hi"), List.of());

        assertThat(bodies.get(0).at("/generationConfig/thinkingConfig/thinkingLevel").asText()).isEqualTo("low");
    }

    @Test
    @DisplayName("A model that rejects the thinking setting (400) is asked again without it, not abandoned")
    void thinkingDroppedWhenRejected() {
        // First request carries thinkingConfig and gets a 400; the repeat has none and succeeds.
        statusByModel.put("m1", List.of(400, 200));

        LlmResult result = client("m1", "m2").generate("s", ask("hi"), List.of());

        assertThat(result.text()).isEqualTo("Hello there");
        assertThat(requests).containsExactly("m1", "m1");
        assertThat(bodies.get(0).at("/generationConfig").has("thinkingConfig")).isTrue();
        assertThat(bodies.get(1).at("/generationConfig").has("thinkingConfig")).isFalse();
    }

    @Test
    @DisplayName("A blank thinking level leaves the model's default alone")
    void blankThinkingLevel() {
        GeminiSettings settings = new GeminiSettings("http://127.0.0.1:" + server.getAddress().getPort() + "/v1beta",
                KEY, List.of("m1"), 5, "");
        @SuppressWarnings("unchecked")
        ObjectProvider<GeminiSettings> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(settings);

        new GeminiClient(provider).generate("s", ask("hi"), List.of());

        assertThat(bodies.get(0).at("/generationConfig").has("thinkingConfig")).isFalse();
    }

    // ---- tool calls

    @Test
    @DisplayName("A tool call is parsed with its id, name and arguments, and reasoning summaries are dropped")
    void toolCallParsed() throws Exception {
        okBody = "{\"candidates\":[{\"content\":{\"parts\":["
                + "{\"text\":\"thinking out loud\",\"thought\":true},"
                + "{\"functionCall\":{\"id\":\"call_1\",\"name\":\"get_quote\",\"args\":{\"symbol\":\"TCS\"}},\"thoughtSignature\":\"abc\"}]}}]}";

        LlmResult result = client("m1").generate("s", ask("price of TCS?"), List.of());

        assertThat(result.text()).isEmpty();
        assertThat(result.calls()).hasSize(1);
        ToolCall call = result.calls().get(0);
        assertThat(call.id()).isEqualTo("call_1");
        assertThat(call.name()).isEqualTo("get_quote");
        assertThat(call.args().get("symbol").asText()).isEqualTo("TCS");
        assertThat(result.raw().toString()).contains("thoughtSignature"); // kept so it can be echoed back
    }

    @Test
    @DisplayName("The model's own parts are handed back unchanged with the tool results (thought signatures survive)")
    void rawPartsEchoedBack() throws Exception {
        JsonNode raw = JSON.readTree("[{\"functionCall\":{\"id\":\"call_1\",\"name\":\"get_quote\",\"args\":{\"symbol\":\"TCS\"}},"
                + "\"thoughtSignature\":\"abc\"}]");
        List<Turn> turns = List.of(
                new Turn.User("price of TCS?"),
                new Turn.Model("", List.of(new ToolCall("call_1", "get_quote", JSON.readTree("{\"symbol\":\"TCS\"}"))), raw),
                new Turn.ToolResults(List.of(new ToolResult("call_1", "get_quote", JSON.readTree("{\"price\":3500}")))));

        client("m1").generate("s", turns, List.of());

        JsonNode body = bodies.get(0);
        assertThat(body.at("/contents/1/role").asText()).isEqualTo("model");
        assertThat(body.at("/contents/1/parts/0/thoughtSignature").asText()).isEqualTo("abc");
        assertThat(body.at("/contents/2/role").asText()).isEqualTo("user");
        assertThat(body.at("/contents/2/parts/0/functionResponse/id").asText()).isEqualTo("call_1");
        assertThat(body.at("/contents/2/parts/0/functionResponse/name").asText()).isEqualTo("get_quote");
        assertThat(body.at("/contents/2/parts/0/functionResponse/response/price").asInt()).isEqualTo(3500);
    }

    @Test
    @DisplayName("A tool result that is not a JSON object is wrapped, since the API wants an object")
    void nonObjectResultWrapped() throws Exception {
        List<Turn> turns = List.of(
                new Turn.User("x"),
                new Turn.Model("", List.of(new ToolCall("c", "t", JSON.createObjectNode())), null),
                new Turn.ToolResults(List.of(new ToolResult("c", "t", JSON.readTree("[1,2,3]")))));

        client("m1").generate("s", turns, List.of());

        assertThat(bodies.get(0).at("/contents/2/parts/0/functionResponse/response/result").size()).isEqualTo(3);
    }

    // ---- fallback and failure

    @Test
    @DisplayName("An overloaded first model (503) is retried once, then the next model is used")
    void overloadRetriedThenFallsBack() {
        statusByModel.put("m1", List.of(503, 503));

        LlmResult result = client("m1", "m2").generate("s", ask("hi"), List.of());

        assertThat(result.text()).isEqualTo("Hello there");
        assertThat(requests).containsExactly("m1", "m1", "m2");
    }

    @Test
    @DisplayName("A 503 that clears on the retry stays on the first model")
    void retrySucceeds() {
        statusByModel.put("m1", List.of(503, 200));

        client("m1", "m2").generate("s", ask("hi"), List.of());

        assertThat(requests).containsExactly("m1", "m1");
    }

    @Test
    @DisplayName("A model that is gone (404) or rate-limited (429) moves straight on to the next one")
    void unavailableModelsAreSkipped() {
        statusByModel.put("m1", List.of(404));
        statusByModel.put("m2", List.of(429));

        LlmResult result = client("m1", "m2", "m3").generate("s", ask("hi"), List.of());

        assertThat(result.text()).isEqualTo("Hello there");
        assertThat(requests).containsExactly("m1", "m2", "m3");
    }

    @Test
    @DisplayName("A rejected key (401/403) stops at once rather than trying every model")
    void rejectedKeyStops() {
        statusByModel.put("m1", List.of(403));

        assertThatThrownBy(() -> client("m1", "m2").generate("s", ask("hi"), List.of()))
                .isInstanceOf(ChatException.class)
                .hasFieldOrPropertyWithValue("code", "CHT-503");
        assertThat(requests).containsExactly("m1");
    }

    @Test
    @DisplayName("When every model fails the caller gets the one generic 'unavailable' error")
    void everyModelFails() {
        statusByModel.put("m1", List.of(500));
        statusByModel.put("m2", List.of(500));

        assertThatThrownBy(() -> client("m1", "m2").generate("s", ask("hi"), List.of()))
                .isInstanceOf(ChatException.class)
                .hasFieldOrPropertyWithValue("code", "CHT-503")
                .hasMessageNotContaining(KEY);
    }

    @Test
    @DisplayName("Without an API key the assistant is switched off cleanly")
    void noKeyConfigured() {
        @SuppressWarnings("unchecked")
        ObjectProvider<GeminiSettings> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(null);

        assertThatThrownBy(() -> new GeminiClient(provider).generate("s", ask("hi"), List.of()))
                .isInstanceOf(ChatException.class)
                .hasFieldOrPropertyWithValue("code", "CHT-503");
    }

    @Test
    @DisplayName("A reply with no candidates (for example a blocked answer) yields empty text, not a crash")
    void emptyCandidates() {
        okBody = "{\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}";

        LlmResult result = client("m1").generate("s", ask("hi"), List.of());

        assertThat(result.text()).isEmpty();
        assertThat(result.calls()).isEmpty();
    }

    // ---- settings

    @Test
    @DisplayName("The settings never print the key")
    void settingsHideTheKey() {
        assertThat(new GeminiSettings("http://x", KEY, new ArrayList<>(List.of("m")), 5, "low").toString()).doesNotContain(KEY);
    }
}
