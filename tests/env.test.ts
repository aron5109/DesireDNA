import { afterEach, describe, expect, it, vi } from "vitest";

import { configurationReport, env, resetEnvCache } from "@/lib/server/env";
import { ConfigurationError } from "@/lib/server/logging";

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROFILE_ENCRYPTION_KEY",
  "SHARE_CODE_HMAC_KEY",
  "OWNER_TOKEN_HMAC_KEY",
  "RATE_LIMIT_HMAC_KEY",
  "CRON_SECRET",
];

/** Clears every variable the config reads, including integration aliases. */
function clearConfig() {
  for (const key of Object.keys(process.env)) {
    if (REQUIRED.some((name) => key === name || key.endsWith(`_${name}`)) || key.endsWith("_SUPABASE_SECRET_KEY")) {
      vi.stubEnv(key, "");
    }
  }
}

function setValidConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-long-enough",
    PROFILE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    SHARE_CODE_HMAC_KEY: "a".repeat(40),
    OWNER_TOKEN_HMAC_KEY: "b".repeat(40),
    RATE_LIMIT_HMAC_KEY: "c".repeat(40),
    CRON_SECRET: "d".repeat(30),
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("server configuration", () => {
  it("accepts a complete configuration", () => {
    clearConfig();
    setValidConfig();
    expect(configurationReport()).toEqual({ ok: true, missing: [], invalid: [] });
    expect(env().SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("names every variable that is missing", () => {
    clearConfig();
    const report = configurationReport();
    expect(report.ok).toBe(false);
    for (const name of REQUIRED) expect(report.missing).toContain(name);
  });

  it("treats an empty or whitespace-only value as missing", () => {
    clearConfig();
    setValidConfig({ CRON_SECRET: "   " });
    expect(configurationReport().missing).toContain("CRON_SECRET");
  });

  it("throws a ConfigurationError carrying the names, and never a value", () => {
    clearConfig();
    setValidConfig({ SUPABASE_URL: "" });
    resetEnvCache();

    try {
      env();
      expect.unreachable("env() should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const configError = error as ConfigurationError;
      expect(configError.details?.missing).toContain("SUPABASE_URL");
      // The secrets themselves must never appear in the message.
      expect(configError.message).not.toContain("service-role-key-long-enough");
      expect(configError.message).not.toContain("d".repeat(30));
    }
  });

  it("explains an encryption key that is the wrong length or not base64", () => {
    clearConfig();
    setValidConfig({ PROFILE_ENCRYPTION_KEY: Buffer.alloc(16, 3).toString("base64") });
    expect(configurationReport().invalid[0]).toMatchObject({
      name: "PROFILE_ENCRYPTION_KEY",
      reason: expect.stringContaining("32 bytes"),
    });

    vi.unstubAllEnvs();
    clearConfig();
    setValidConfig({ PROFILE_ENCRYPTION_KEY: "not valid base64 at all!!" });
    expect(configurationReport().invalid[0]?.reason).toContain("base64");
  });

  it("rejects a Supabase URL that is not a URL", () => {
    clearConfig();
    setValidConfig({ SUPABASE_URL: "example.supabase.co" });
    expect(configurationReport().invalid[0]).toMatchObject({ name: "SUPABASE_URL" });
  });

  it("accepts Supabase variables from an integration prefix of any name", () => {
    clearConfig();
    setValidConfig({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" });
    vi.stubEnv("anystorename_SUPABASE_URL", "https://from-integration.supabase.co");
    vi.stubEnv("anystorename_SUPABASE_SERVICE_ROLE_KEY", "integration-service-role-key");
    resetEnvCache();

    expect(configurationReport().ok).toBe(true);
    expect(env().SUPABASE_URL).toBe("https://from-integration.supabase.co");
  });

  it("accepts the newer SUPABASE_SECRET_KEY name for the service key", () => {
    clearConfig();
    setValidConfig({ SUPABASE_SERVICE_ROLE_KEY: "" });
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_value_long_enough_here");
    resetEnvCache();

    expect(configurationReport().ok).toBe(true);
    expect(env().SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_value_long_enough_here");
  });

  it("prefers a plain variable over an integration-prefixed one", () => {
    clearConfig();
    setValidConfig({ SUPABASE_URL: "https://direct.supabase.co" });
    vi.stubEnv("zzstore_SUPABASE_URL", "https://integration.supabase.co");
    resetEnvCache();

    expect(env().SUPABASE_URL).toBe("https://direct.supabase.co");
  });
});
