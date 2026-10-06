package com.team1.trading.api.notifications;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

public final class MessageComposer {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int TEXT_LIMIT = 200;
    private static final String FALLBACK = "A notification was recorded for your account.";

    private MessageComposer() {
    }

    public static String tradePayload(JsonNode event) {
        ObjectNode out = MAPPER.createObjectNode();
        copy(event, out, "orderId");
        copy(event, out, "symbol");
        copy(event, out, "side");
        copy(event, out, "quantity");
        copy(event, out, "price");
        copy(event, out, "executedPrice");
        copy(event, out, "status");
        copy(event, out, "reason");
        copy(event, out, "executedOn");
        return out.toString();
    }

    public static String alertPayload(AlertNotification alert) {
        ObjectNode out = MAPPER.createObjectNode();
        out.put("symbol", alert.symbol().trim());
        out.put("threshold", alert.threshold().toPlainString());
        out.put("direction", alert.direction().name());
        out.put("observedPrice", alert.observedPrice().toPlainString());
        out.put("observedAt", alert.observedAt().toString());
        return out.toString();
    }

    public static String subject(NotificationKind kind) {
        return switch (kind) {
            case ORDER_FILLED -> "Your order was filled";
            case ORDER_REJECTED -> "Your order was rejected";
            case ORDER_CANCELLED -> "Your order was cancelled";
            case PRICE_ALERT -> "Price alert";
        };
    }

    public static String message(NotificationKind kind, String payloadJson) {
        JsonNode p = parse(payloadJson);
        if (p == null) {
            return FALLBACK;
        }
        String symbol = text(p, "symbol");
        if (symbol == null) {
            return FALLBACK;
        }
        return switch (kind) {
            case ORDER_FILLED -> {
                String price = firstNonNull(text(p, "executedPrice"), text(p, "price"));
                yield "Your " + order(p, symbol) + " was filled" + (price == null ? "" : " at " + price) + ".";
            }
            case ORDER_REJECTED -> {
                String reason = text(p, "reason");
                yield "Your " + order(p, symbol) + " was rejected" + (reason == null ? "" : ": " + reason) + ".";
            }
            case ORDER_CANCELLED -> "Your " + order(p, symbol) + " was cancelled.";
            case PRICE_ALERT -> {
                String direction = "BELOW".equals(text(p, "direction")) ? "below" : "above";
                String threshold = text(p, "threshold");
                String observed = text(p, "observedPrice");
                if (threshold == null || observed == null) {
                    yield FALLBACK;
                }
                yield "Price alert: " + symbol + " is " + direction + " " + threshold + " (now " + observed + ").";
            }
        };
    }

    private static String order(JsonNode p, String symbol) {
        String side = text(p, "side");
        String quantity = text(p, "quantity");
        StringBuilder sb = new StringBuilder();
        if (side != null) {
            sb.append(side).append(' ');
        }
        sb.append("order for ");
        if (quantity != null) {
            sb.append(quantity).append(' ');
        }
        return sb.append(symbol).toString();
    }

    private static void copy(JsonNode from, ObjectNode to, String field) {
        JsonNode node = from == null ? null : from.get(field);
        if (node == null || node.isNull()) {
            return;
        }
        String value = node.isNumber() ? node.decimalValue().toPlainString() : clean(node.asText());
        if (value != null) {
            to.put(field, value);
        }
    }

    private static JsonNode parse(String json) {
        try {
            return json == null ? null : MAPPER.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : clean(value.asText());
    }

    private static String clean(String value) {
        if (value == null) {
            return null;
        }
        String cleaned = value.replaceAll("\\p{Cntrl}", " ").trim();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > TEXT_LIMIT ? cleaned.substring(0, TEXT_LIMIT) : cleaned;
    }

    private static String firstNonNull(String a, String b) {
        return a != null ? a : b;
    }
}
