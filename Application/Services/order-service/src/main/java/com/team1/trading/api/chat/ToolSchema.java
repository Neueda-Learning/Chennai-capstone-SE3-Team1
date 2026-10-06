package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Builds the small JSON-schema-style description of a tool's arguments. */
final class ToolSchema {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final ObjectNode root = JSON.createObjectNode().put("type", "OBJECT");
    private final ObjectNode properties = root.putObject("properties");
    private final ArrayNode required = JSON.createArrayNode();

    static ToolSchema object() {
        return new ToolSchema();
    }

    ToolSchema prop(String name, String type, String description) {
        properties.putObject(name).put("type", type).put("description", description);
        return this;
    }

    /** A list of values of one type, for example a list of stock symbols. */
    ToolSchema arrayOf(String name, String itemType, String description) {
        ObjectNode property = properties.putObject(name).put("type", "ARRAY").put("description", description);
        property.putObject("items").put("type", itemType);
        return this;
    }

    ToolSchema required(String name) {
        required.add(name);
        return this;
    }

    ObjectNode build() {
        if (!required.isEmpty()) {
            root.set("required", required);
        }
        return root;
    }
}
