/**
 * RFC 8785 JSON Canonicalisation Scheme (JCS), and the digests taken over it.
 *
 * Pure ring: no I/O. It exists because an approval must bind to *content* rather than to a
 * name (submit-gate packet D2, D14; architecture review A11). Two byte-different files that
 * carry the same JSON value must produce the same token, and a single changed value - a swapped
 * submit selector, an edited intended value - must produce a different one. `JSON.stringify`
 * cannot do that: its key order is insertion order, so re-serialising a parsed plan can move a
 * key and change the hash without changing the meaning.
 *
 * JCS in the shape this file implements it:
 *   - object keys sorted by UTF-16 code unit (JavaScript's default string ordering),
 *   - no insignificant whitespace,
 *   - array order preserved,
 *   - strings escaped exactly as `JSON.stringify` escapes them (which is already the JCS rule),
 *   - numbers serialised by ECMAScript `Number::toString`, with `-0` normalised to `0`.
 *
 * Everything else is refused rather than coerced: `undefined`, a function, a symbol, a bigint,
 * `NaN`, an infinity and any object that is not a plain object or array have no canonical form,
 * and guessing one would make two different values hash the same.
 */

import { createHash } from "node:crypto";

/** A value that has a canonical form. Anything else is refused by {@link canonicalJson}. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function refuse(path: string, what: string): never {
  throw new TypeError(
    `Cannot canonicalise ${path || "the value"}: ${what} has no RFC 8785 representation.`,
  );
}

function canonicalNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    refuse(path, Number.isNaN(value) ? "NaN" : "an infinity");
  }
  // JCS normalises negative zero; every other number is ECMAScript's shortest round-trip form,
  // which is what `String(value)` produces.
  return Object.is(value, -0) ? "0" : String(value);
}

function canonicalize(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return canonicalNumber(value, path);
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return refuse(path, "undefined");
    case "bigint":
      return refuse(path, "a bigint");
    case "function":
      return refuse(path, "a function");
    case "symbol":
      return refuse(path, "a symbol");
    default:
      break;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalize(entry, `${path}[${index}]`)).join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    refuse(path, `an instance of ${(value as object).constructor?.name ?? "a class"}`);
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, entry]) => entry !== undefined,
  );
  // Default string sort is UTF-16 code unit order, which is exactly the JCS rule.
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const members = entries.map(
    ([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry, `${path}.${key}`)}`,
  );
  return `{${members.join(",")}}`;
}

/**
 * The RFC 8785 canonical form of `value` as a UTF-8 string.
 *
 * An object member whose value is `undefined` is dropped, exactly as `JSON.stringify` drops it,
 * so a value that round-trips through JSON canonicalises to the same bytes before and after.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, "");
}

/** `sha256:<hex>` over the canonical form of `value`. */
export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf-8").digest("hex")}`;
}
