import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Uppercase alphabet without the ambiguous characters O, 0, I, and 1. Its
 * length (32) divides 256 exactly, so a byte can be reduced modulo the
 * alphabet without introducing bias.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;
const PREFIX = "DDNA";

/**
 * A DesireCode such as `DDNA-7K4M-X92Q-W8TR-P3ZC`.
 * 16 characters from a 32-symbol alphabet carries 80 bits of entropy, drawn
 * from the platform CSPRNG (never Math.random).
 */
export function generateDesireCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let body = "";
  for (let i = 0; i < CODE_LENGTH; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return `${PREFIX}-${body.match(/.{1,4}/g)!.join("-")}`;
}

/**
 * Accepts codes pasted with or without the prefix, hyphens, spaces, or in
 * lower case, and returns the canonical form. Returns null for anything that
 * is not a well-formed code — including characters outside the alphabet, so a
 * mistyped O or 1 is reported rather than silently dropped.
 */
export function normalizeDesireCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s\-_.]/g, "");
  const body =
    compact.length === CODE_LENGTH + PREFIX.length && compact.startsWith(PREFIX)
      ? compact.slice(PREFIX.length)
      : compact;

  if (body.length !== CODE_LENGTH) return null;
  if ([...body].some((character) => !ALPHABET.includes(character))) return null;

  return `${PREFIX}-${body.match(/.{1,4}/g)!.join("-")}`;
}

/** 256 bits of cryptographically secure randomness, held only in the owner cookie. */
export const generateOwnerToken = () => randomBytes(32).toString("base64url");
