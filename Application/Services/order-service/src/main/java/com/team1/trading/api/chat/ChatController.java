package com.team1.trading.api.chat;

import com.team1.trading.api.security.TokenAccountIdResolver;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/accounts")
public class ChatController {

    private final ChatService chat;
    private final TokenAccountIdResolver tokenAccountIdResolver;

    public ChatController(ChatService chat, TokenAccountIdResolver tokenAccountIdResolver) {
        this.chat = chat;
        this.tokenAccountIdResolver = tokenAccountIdResolver;
    }

    @PostMapping("/{id}/chat")
    public ResponseEntity<ChatResponse> chat(@PathVariable("id") Long id,
                                             @Valid @RequestBody ChatRequest request,
                                             @RequestHeader(value = "Authorization", required = false)
                                             String authorization) {
        Long tokenAccountId = tokenAccountIdResolver.resolve(authorization);
        return ResponseEntity.ok(chat.chat(id, tokenAccountId, request.getMessages()));
    }
}
