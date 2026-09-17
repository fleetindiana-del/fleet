/**
 * Shared normalization helpers for contact merging. Used at ingest time (to
 * stamp indexed keys on write), by the merge job (to cluster records), and by
 * any lookup that needs to match "the same person" across differently
 * formatted names/numbers. Keeping one implementation avoids the merge job
 * and the write path silently drifting apart.
 */

export function normalizeContactName(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhoneDigits(v: unknown): string {
  return String(v ?? "").replace(/\D+/g, "");
}

// Same number written as 07698465970 / +917698465970 / 7698465970 must
// collapse to one key: drop non-digits, then keep the last 10 (subscriber)
// digits so country-code/leading-zero variants match.
export function phoneKeyOf(v: unknown): string {
  const digits = normalizePhoneDigits(v);
  return digits.length > 10 ? digits.slice(-10) : digits;
}
