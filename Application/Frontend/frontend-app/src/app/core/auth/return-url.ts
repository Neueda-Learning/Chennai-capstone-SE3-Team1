export const RETURN_URL_PARAM = 'returnUrl';

export function sanitiseReturnUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  if (!raw.startsWith('/')) {
    return null;
  }

  if (raw.startsWith('//') || raw.startsWith('/\\')) {
    return null;
  }

  if (raw.includes('\\')) {
    return null;
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }

  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login#')) {
    return null;
  }

  return raw;
}
