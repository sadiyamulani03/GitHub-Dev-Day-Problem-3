/**
 * Cookie helpers.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  const start = header.indexOf(prefix);
  if (start === -1) return null;
  const end = header.indexOf(';', start);
  const value = header.slice(start + prefix.length, end === -1 ? undefined : end);
  return value.trim() || null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    maxAge?: number;
    path?: string;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  return parts.join('; ');
}