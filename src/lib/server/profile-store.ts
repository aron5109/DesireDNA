import "server-only";

import { db } from "./supabase";
import { decrypt, encrypt, hmac } from "./crypto";
import { encryptionKeyForVersion, env } from "./env";
import { ConfigurationError, logServerError } from "./logging";
import type { ProfilePayload, ShareMode } from "@/lib/quiz/types";

export interface ProfileRow {
  id: string;
  owner_token_hash: string;
  share_code_hash: string;
  payload_ciphertext: string;
  payload_iv: string;
  payload_auth_tag: string;
  encryption_key_version: number;
  share_mode: ShareMode;
  expires_at: string;
  quiz_version: string;
}

export interface StoredProfile {
  row: ProfileRow;
  payload: ProfilePayload;
}

export class UnreadableProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableProfileError";
  }
}

/**
 * Decrypts a row with the key version it was written under. Rotating the
 * active key must not make older records unreadable, so the old key stays
 * configured as `PROFILE_ENCRYPTION_KEY_V<n>` until those records expire.
 */
function decode(row: ProfileRow): ProfilePayload {
  const version = row.encryption_key_version ?? 1;
  const key = encryptionKeyForVersion(version);
  if (!key) {
    throw new ConfigurationError(
      `No encryption key configured for key version ${version} — set PROFILE_ENCRYPTION_KEY_V${version}`,
    );
  }
  return decrypt<ProfilePayload>(
    { ciphertext: row.payload_ciphertext, iv: row.payload_iv, authTag: row.payload_auth_tag },
    key,
  );
}

function sealFor(payload: ProfilePayload) {
  const config = env();
  const sealed = encrypt(payload, config.PROFILE_ENCRYPTION_KEY);
  return {
    payload_ciphertext: sealed.ciphertext,
    payload_iv: sealed.iv,
    payload_auth_tag: sealed.authTag,
    encryption_key_version: config.PROFILE_ENCRYPTION_KEY_VERSION,
  };
}

const activeFilter = () => new Date().toISOString();

export async function createStoredProfile(
  owner: string,
  code: string,
  payload: ProfilePayload,
  expiresAt: string,
): Promise<ProfileRow> {
  const config = env();
  const { data, error } = await db()
    .from("quiz_profiles")
    .insert({
      owner_token_hash: hmac(owner, config.OWNER_TOKEN_HMAC_KEY),
      share_code_hash: hmac(code, config.SHARE_CODE_HMAC_KEY),
      ...sealFor(payload),
      quiz_version: payload.quizVersion,
      share_mode: payload.shareMode,
      consent_version: "2026.2",
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ProfileRow;
}

export async function byOwner(owner: string): Promise<StoredProfile | null> {
  const config = env();
  const { data, error } = await db()
    .from("quiz_profiles")
    .select("*")
    .eq("owner_token_hash", hmac(owner, config.OWNER_TOKEN_HMAC_KEY))
    .is("revoked_at", null)
    .gt("expires_at", activeFilter())
    .maybeSingle();

  if (error) throw error;
  return data ? { row: data as ProfileRow, payload: decode(data as ProfileRow) } : null;
}

export async function byCode(code: string): Promise<StoredProfile | null> {
  const config = env();
  const { data, error } = await db()
    .from("quiz_profiles")
    .select("*")
    .eq("share_code_hash", hmac(code, config.SHARE_CODE_HMAC_KEY))
    .is("revoked_at", null)
    .gt("expires_at", activeFilter())
    .maybeSingle();

  if (error) throw error;
  return data ? { row: data as ProfileRow, payload: decode(data as ProfileRow) } : null;
}

export async function removeOwner(owner: string): Promise<void> {
  const config = env();
  const { error } = await db()
    .from("quiz_profiles")
    .delete()
    .eq("owner_token_hash", hmac(owner, config.OWNER_TOKEN_HMAC_KEY));
  if (error) throw error;
}

/** Deletes one specific row, used when a replacement profile has been saved. */
export async function removeById(id: string): Promise<void> {
  const { error } = await db().from("quiz_profiles").delete().eq("id", id);
  if (error) throw error;
}

export async function setShareMode(owner: string, mode: ShareMode): Promise<boolean> {
  const current = await byOwner(owner);
  if (!current) return false;

  const payload: ProfilePayload = { ...current.payload, shareMode: mode };
  const { error } = await db()
    .from("quiz_profiles")
    .update({ share_mode: mode, ...sealFor(payload) })
    .eq("id", current.row.id);

  if (error) throw error;
  return true;
}

/**
 * Issues a fresh DesireCode for an existing profile. The payload and the
 * lookup hash are written together, so the old code stops resolving the moment
 * the new one starts working; ownership is untouched.
 */
export async function rotateShareCode(owner: string, newCode: string): Promise<boolean> {
  const config = env();
  const current = await byOwner(owner);
  if (!current) return false;

  const payload: ProfilePayload = { ...current.payload, desireCode: newCode };
  const { error } = await db()
    .from("quiz_profiles")
    .update({
      share_code_hash: hmac(newCode, config.SHARE_CODE_HMAC_KEY),
      ...sealFor(payload),
    })
    .eq("id", current.row.id);

  if (error) throw error;
  return true;
}

/**
 * Removes expired rows. Awaited by callers: a promise left dangling after the
 * response is returned is not guaranteed to run to completion on a serverless
 * platform, so cleanup either happens before the response or is left to the
 * scheduled purge.
 */
export async function purgeExpired(): Promise<number> {
  try {
    const { count, error } = await db()
      .from("quiz_profiles")
      .delete({ count: "exact" })
      .lte("expires_at", activeFilter());
    if (error) throw error;
    return count ?? 0;
  } catch (error) {
    // Cleanup is best-effort: the scheduled purge is the guarantee, and expired
    // rows are already unreachable through every read path above.
    logServerError("profile-store:purge", error);
    return 0;
  }
}
