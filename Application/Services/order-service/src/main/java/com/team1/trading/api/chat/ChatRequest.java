package com.team1.trading.api.chat;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * The conversation so far, kept by the browser. Only "user" and "assistant" turns are accepted: the
 * client cannot supply a system or tool turn, so it cannot put words in the mouth of either.
 */
public class ChatRequest {

    public static final int MAX_MESSAGES = 20;
    public static final int MAX_TEXT = 1_500;

    @NotEmpty
    @Size(max = MAX_MESSAGES)
    @Valid
    private List<Message> messages;

    public List<Message> getMessages() {
        return messages;
    }

    public void setMessages(List<Message> messages) {
        this.messages = messages;
    }

    public static class Message {

        @NotBlank
        @Pattern(regexp = "user|assistant")
        private String role;

        @NotBlank
        @Size(max = MAX_TEXT)
        private String text;

        public Message() {
        }

        public Message(String role, String text) {
            this.role = role;
            this.text = text;
        }

        public String getRole() {
            return role;
        }

        public void setRole(String role) {
            this.role = role;
        }

        public String getText() {
            return text;
        }

        public void setText(String text) {
            this.text = text;
        }
    }
}
