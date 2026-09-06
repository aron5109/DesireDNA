import "server-only";

import { ZodError } from "zod";

/**
 * Redacted server logging.
 *
 * Only a scope and a short error identity are ever written. Answers, results,
 * DesireCodes, owner tokens, keys, and request bodies must never reach the
 * logs, so a Zod failure is reduced to the field paths that failed — its
 * default message embeds the offending input.
 */
export function logServerError(scope: string, error: unknown): void {
  console.error(`[desiredna:${scope}] ${describe(error)}`);
}

/**
 * A Supabase/Postgres error, reduced to the parts that describe the *schema*
 * problem. `details` and `hint` can echo a stored value, so they are dropped.
 */
export function describeStorageError(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.message !== "string") return null;

  const code = typeof candidate.code === "string" ? `${candidate.code}: ` : "";
  return `${code}${candidate.message}`;
}

function describe(error: unknown): string {
  if (error instanceof ZodError) {
    const fields = error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    return `ZodError: invalid fields: ${fields}`;
  }
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  return "UnknownError";
}

export interface ConfigurationDetails {
  missing: string[];
  invalid: { name: string; reason: string }[];
}

/**
 * Raised when the deployment is missing or misconfiguring server secrets.
 * `details` carries variable names and reasons only — never a value — so it is
 * safe to show to whoever is trying to get the deployment working.
 */
export class ConfigurationError extends Error {
  readonly details?: ConfigurationDetails;

  constructor(message: string, details?: ConfigurationDetails) {
    super(message);
    this.name = "ConfigurationError";
    this.details = details;
  }
}
