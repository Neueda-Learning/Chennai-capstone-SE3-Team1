export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_ISSUER = 'auth-service';

/** A refresh token presented again within this many seconds of being replaced is a race (two tabs or
 * two requests renewing at once), not theft: it is refused without revoking the whole session. */
export const REFRESH_REUSE_GRACE_SECONDS = 60;
