package com.team1.trading.api.chat;

import com.team1.trading.api.exception.ErrorCatalogue;
import com.team1.trading.domain.exception.DomainException;

/** The chat module's two refusals, both carried through the service's normal error envelope. */
public class ChatException extends DomainException {

    private ChatException(String code, String message) {
        super(code, message);
    }

    /** Too many messages from one account in the window. */
    public static ChatException rateLimited() {
        return new ChatException(ErrorCatalogue.CHT_429,
                "You are sending messages too quickly. Please wait a few minutes and try again.");
    }

    /** No key configured, or the model could not be reached. The text is safe to show a user. */
    public static ChatException unavailable() {
        return new ChatException(ErrorCatalogue.CHT_503,
                "The assistant is unavailable right now. Please try again in a moment.");
    }
}
