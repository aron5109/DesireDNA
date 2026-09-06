import "server-only";

import { ConfigurationError } from "./logging";

export interface ServerConfig {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PROFILE_ENCRYPTION_KEY: string;
  PROFILE_ENCRYPTION_KEY_VERSION: number;
  SHARE_CODE_HMAC_KEY: string;
  OWNER_TOKEN_HMAC_KEY: string;
  RATE_LIMIT_HMAC_KEY: string;
  CRON_SECRET: string;
}

export interface ConfigurationReport {
  ok: boolean;
  /** Variables that are unset or empty. */
  missing: string[];
  /** Variables that are set but unusable, each with a short reason. */
  invalid: { name: string; reason: string }[];
}

/** Treats an unset, empty, or whitespace-only variable as absent. */
function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Finds a value under any of the given names, then under any environment
 * variable ending in one of them.
 *
 * Vercel's Supabase integration prefixes its variables with the storage
 * name chosen in the dashboard (`dnastorage_SUPABASE_URL`, and so on), which
 * differs between projects. Matching on the suffix means the integration works
 * whatever the store is called, while a plain `SUPABASE_URL` still wins.
 */
function resolve(names: string[]): string | undefined {
  for (const name of names) {
    const direct = read(name);
    if (direct) return direct;
  }
  // Sorted so a project with several integrations resolves deterministically.
  for (const key of Object.keys(process.env).sort()) {
    if (names.some((name) => key !== name && key.endsWith(`_${name}`))) {
      const value = read(key);
      if (value) return value;
    }
  }
  return undefined;
}

/** Decodes base64 strictly: `Buffer.from` silently drops invalid characters. */
function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "") ? decoded : null;
}

/**
 * Inspects the environment without throwing. Returns the names of anything
 * missing or unusable — never a value — so an operator can be told exactly
 * what to set.
 */
export function configurationReport(): ConfigurationReport {
  const missing: string[] = [];
  const invalid: { name: string; reason: string }[] = [];

  const supabaseUrl = resolve(["SUPABASE_URL"]);
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  else if (!/^https?:\/\/.+/.test(supabaseUrl)) {
    invalid.push({ name: "SUPABASE_URL", reason: "must be a full URL starting with https://" });
  }

  const serviceKey = resolve(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]);
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  else if (serviceKey.length < 20) {
    invalid.push({ name: "SUPABASE_SERVICE_ROLE_KEY", reason: "looks too short to be a service-role key" });
  }

  const encryptionKey = resolve(["PROFILE_ENCRYPTION_KEY"]);
  if (!encryptionKey) missing.push("PROFILE_ENCRYPTION_KEY");
  else {
    const decoded = decodeBase64(encryptionKey);
    if (!decoded) {
      invalid.push({ name: "PROFILE_ENCRYPTION_KEY", reason: "is not valid base64 — use: openssl rand -base64 32" });
    } else if (decoded.length !== 32) {
      invalid.push({
        name: "PROFILE_ENCRYPTION_KEY",
        reason: `must decode to exactly 32 bytes (this one is ${decoded.length}) — use: openssl rand -base64 32`,
      });
    }
  }

  for (const name of ["SHARE_CODE_HMAC_KEY", "OWNER_TOKEN_HMAC_KEY", "RATE_LIMIT_HMAC_KEY"]) {
    const value = resolve([name]);
    if (!value) missing.push(name);
    else if (value.length < 32) {
      invalid.push({ name, reason: "must be at least 32 characters — use: openssl rand -base64 32" });
    }
  }

  const cronSecret = resolve(["CRON_SECRET"]);
  if (!cronSecret) missing.push("CRON_SECRET");
  else if (cronSecret.length < 24) {
    invalid.push({ name: "CRON_SECRET", reason: "must be at least 24 characters — use: openssl rand -base64 48" });
  }

  const version = resolve(["PROFILE_ENCRYPTION_KEY_VERSION"]);
  if (version && !/^[1-9]\d*$/.test(version)) {
    invalid.push({ name: "PROFILE_ENCRYPTION_KEY_VERSION", reason: "must be a positive whole number" });
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

let cached: ServerConfig | undefined;

/**
 * Reads server-only configuration, failing closed with a message that names
 * every variable an operator still has to set.
 */
export function env(): ServerConfig {
  if (cached) return cached;

  const report = configurationReport();
  if (!report.ok) {
    const parts = [
      report.missing.length ? `missing: ${report.missing.join(", ")}` : null,
      report.invalid.length
        ? `invalid: ${report.invalid.map((entry) => `${entry.name} (${entry.reason})`).join("; ")}`
        : null,
    ].filter(Boolean);

    throw new ConfigurationError(`Server configuration incomplete — ${parts.join(" | ")}`, report);
  }

  cached = {
    SUPABASE_URL: resolve(["SUPABASE_URL"])!,
    SUPABASE_SERVICE_ROLE_KEY: resolve(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"])!,
    PROFILE_ENCRYPTION_KEY: resolve(["PROFILE_ENCRYPTION_KEY"])!,
    PROFILE_ENCRYPTION_KEY_VERSION: Number(resolve(["PROFILE_ENCRYPTION_KEY_VERSION"]) ?? 1),
    SHARE_CODE_HMAC_KEY: resolve(["SHARE_CODE_HMAC_KEY"])!,
    OWNER_TOKEN_HMAC_KEY: resolve(["OWNER_TOKEN_HMAC_KEY"])!,
    RATE_LIMIT_HMAC_KEY: resolve(["RATE_LIMIT_HMAC_KEY"])!,
    CRON_SECRET: resolve(["CRON_SECRET"])!,
  };
  return cached;
}

/**
 * The key for a stored record's encryption-key version.
 *
 * Records keep the version they were written with. A record written under an
 * older key is decrypted with that older key — read from
 * `PROFILE_ENCRYPTION_KEY_V<n>` — rather than blindly with the current one.
 */
export function encryptionKeyForVersion(version: number): string | null {
  const config = env();
  if (version === config.PROFILE_ENCRYPTION_KEY_VERSION) return config.PROFILE_ENCRYPTION_KEY;
  return resolve([`PROFILE_ENCRYPTION_KEY_V${version}`]) ?? null;
}

/** Test seam: clears the memoised configuration. */
export function resetEnvCache(): void {
  cached = undefined;
}
