/**
 * The query parameter the guard writes the attempted destination into, and the
 * sign-in page reads it back out of. Both sides must import this constant
 * rather than writing the string twice, or the redirect silently lands on the
 * dashboard instead of the page the user asked for.
 */
export const RETURN_URL_PARAM = 'returnUrl';

/**
 * Reduce an untrusted return address to a path on this origin, or `null`.
 *
 * An open redirect on a trading sign-in page is a phishing kit somebody else
 * assembles for free: the link looks like ours, the sign-in form looks like
 * ours, and the user types a real password into somebody else's page before
 * being dropped back where they meant to go. So the only thing accepted is a
 * same-origin path.
 */
export function sanitiseReturnUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  // Must be a path on this origin, so it opens with exactly one slash. This
  // alone rejects `https://evil.example`, `javascript:alert(1)` and `login`.
  if (!raw.startsWith('/')) {
    return null;
  }

  // `//evil.example` and `/\evil.example` are authority, not path — browsers
  // normalise the backslash to a slash, so both leave the origin.
  if (raw.startsWith('//') || raw.startsWith('/\\')) {
    return null;
  }

  // A backslash anywhere is either that same authority trick or a parser
  // disagreement we would rather not depend on.
  if (raw.includes('\\')) {
    return null;
  }

  // Control characters let a crafted value survive one parser and not another.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }

  // Sending someone back to sign-in is a loop, and it is never what they meant.
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login#')) {
    return null;
  }

  return raw;
}
