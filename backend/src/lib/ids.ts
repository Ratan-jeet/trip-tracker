// Identifier generation built on node:crypto.
//
// This replaces nanoid, which ships as ESM only from v5. The backend compiles to
// CommonJS, so the built `dist/index.js` did `require("nanoid")` and threw
// ERR_REQUIRE_ESM on boot — `npm start` could not start. Development never hit it
// because tsx resolves ESM transparently.

import { randomBytes, timingSafeEqual } from 'node:crypto';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Unambiguous when read aloud or typed: no O/0, I/1, or U (to avoid accidental words). */
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';

function randomFromAlphabet(length: number, alphabet: string): string {
  // Rejection sampling keeps the distribution uniform; a plain modulo would bias
  // toward the start of the alphabet.
  const max = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Primary keys. 21 chars of the 64-symbol alphabet ≈ 126 bits. */
export function newId(): string {
  return randomFromAlphabet(21, ID_ALPHABET);
}

/**
 * Trip invite codes. 8 chars of a 31-symbol alphabet ≈ 39 bits, and unlike the old
 * `nanoid(8).toUpperCase()` no entropy is thrown away by folding case.
 */
export function newInviteCode(): string {
  return randomFromAlphabet(8, INVITE_ALPHABET);
}

/**
 * Normalise user input before looking an invite code up. Lookups used to be
 * case-sensitive, so typing the code in lowercase simply failed. The alphabet already
 * excludes 0/1/I/O/U, so no confusable substitution is needed — just fold case and
 * drop separators people add when reading a code aloud.
 */
export function normaliseInviteCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Bearer secret for a tracker device. 256 bits. */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison for secrets that arrive from a request. */
export function secretsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
