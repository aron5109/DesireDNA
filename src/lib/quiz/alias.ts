/**
 * Display aliases ("random usernames") assigned when a person starts the quiz.
 *
 * The alias is deliberately non-identifying: it is drawn from a fixed, tasteful
 * word list and carries no personal data. It exists so a result and a
 * comparison have a friendly handle instead of a bare code, and it is stored
 * inside the encrypted profile payload.
 *
 * Because a comparison shows the partner's alias, aliases must never be free
 * text. `isValidAlias` re-checks every submitted alias against these lists so
 * an attacker cannot inject arbitrary strings into another adult's screen.
 */

export const ALIAS_ADJECTIVES = [
  "Amber", "Aurora", "Azure", "Bold", "Bright", "Calm", "Candid", "Cobalt",
  "Copper", "Crimson", "Curious", "Dusk", "Ember", "Frank", "Gentle", "Gilded",
  "Golden", "Hidden", "Indigo", "Ivory", "Jade", "Lucid", "Lunar", "Midnight",
  "Noble", "Northern", "Onyx", "Opal", "Quiet", "Rapid", "Rogue", "Ruby",
  "Sable", "Scarlet", "Silent", "Silver", "Solar", "Steady", "Velvet", "Wild",
] as const;

export const ALIAS_NOUNS = [
  "Aster", "Beacon", "Canyon", "Cedar", "Cipher", "Comet", "Compass", "Coral",
  "Current", "Delta", "Ember", "Falcon", "Fern", "Harbor", "Helix", "Heron",
  "Horizon", "Iris", "Lantern", "Lark", "Lotus", "Meadow", "Meridian", "Nebula",
  "Nomad", "Orchid", "Otter", "Pioneer", "Quartz", "Raven", "Ridge", "River",
  "Sable", "Signal", "Sparrow", "Summit", "Thistle", "Tide", "Vector", "Willow",
] as const;

const ALIAS_PATTERN = /^([A-Za-z]+) ([A-Za-z]+) (\d{4})$/;

const adjectives: ReadonlySet<string> = new Set(ALIAS_ADJECTIVES);
const nouns: ReadonlySet<string> = new Set(ALIAS_NOUNS);

/** Uniform random integer below `max`, using the platform CSPRNG. */
function randomBelow(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

/** Builds a fresh alias such as `Velvet Orchid 4821`. */
export function generateAlias(): string {
  const adjective = ALIAS_ADJECTIVES[randomBelow(ALIAS_ADJECTIVES.length)];
  const noun = ALIAS_NOUNS[randomBelow(ALIAS_NOUNS.length)];
  const digits = String(randomBelow(10000)).padStart(4, "0");
  return `${adjective} ${noun} ${digits}`;
}

/** True only for aliases built from the curated word lists. */
export function isValidAlias(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ALIAS_PATTERN.exec(value);
  if (!match) return false;
  return adjectives.has(match[1]) && nouns.has(match[2]);
}

/** Returns the submitted alias when it is trustworthy, otherwise a new one. */
export function sanitizeAlias(value: unknown): string {
  return isValidAlias(value) ? value : generateAlias();
}
