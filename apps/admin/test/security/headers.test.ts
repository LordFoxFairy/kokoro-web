import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("Admin browser response headers", () => {
  it("WEB-SEC-HEADER-001 applies the complete security header set without a gateway rewrite", async () => {
    const config = nextConfig as typeof nextConfig & Readonly<{
      headers(): Promise<Array<Readonly<{
        source: string;
        headers: Array<Readonly<{ key: string; value: string }>>;
      }>>>;
    }>;
    const rules = await config.headers();
    const headers = Object.fromEntries(rules[0]?.headers.map((entry) => [entry.key, entry.value]) ?? []);

    expect(rules[0]?.source).toBe("/:path*");
    expect(headers).toMatchObject({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    expect("rewrites" in config).toBe(false);
  });
});
