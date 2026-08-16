import "server-only";

export type SessionCookieConfig = Readonly<{ secureCookies: boolean }>;
export type SessionCookieReader = Readonly<{
  get(name: string): Readonly<{ value: string }> | undefined;
}>;
export type AdminSessionCookie = Readonly<{
  name: string;
  options: Readonly<{
    httpOnly: true;
    sameSite: "lax";
    path: "/";
    secure: boolean;
  }>;
}>;

const tokenPattern = /^[A-Za-z0-9._~-]{32,1024}$/u;

export function sessionCookie(config: SessionCookieConfig): AdminSessionCookie {
  return Object.freeze({
    name: config.secureCookies
      ? "__Secure-kokoro.admin.session-token"
      : "kokoro.admin.session-token",
    options: Object.freeze({
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: config.secureCookies,
    }),
  });
}

export function readSessionToken(reader: SessionCookieReader, config: SessionCookieConfig): string | null {
  const value = reader.get(sessionCookie(config).name)?.value;
  return value !== undefined && tokenPattern.test(value) ? value : null;
}
