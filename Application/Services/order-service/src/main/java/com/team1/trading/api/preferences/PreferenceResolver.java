package com.team1.trading.api.preferences;

import java.util.Optional;

public interface PreferenceResolver {

    /**
     * Resolve the channel and contact address for an account, reading auth_db.users at call time.
     * Nothing is cached.
     *
     * Returns Optional.empty() when no preference row exists, when the stored channel is NULL,
     * or when the stored email address is blank.
     * Throws PreferenceResolutionException when the read itself fails, or when a stored preference
     * has no auth_db.users row behind it. A missing preference is never an exception.
     */
    Optional<ResolvedChannel> resolve(long accountId);
}
