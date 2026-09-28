/**
 * Shadow paths: how a plan addresses an element inside open shadow roots (AK #6163; design
 * `docs/project/2026-09-27-cdp-channel-program.md`, section 5).
 *
 * A path is CSS segments joined by {@link SHADOW_SEPARATOR}. The first segment is resolved in the
 * document; each later one inside the open shadow root of the one element the segment before it
 * matched. A path of one segment is a plain CSS selector, resolved in the document exactly as
 * before, so a plan with no shadow path reads, hashes and acts as it always did. The separator
 * counts only outside quotes, brackets, parentheses and comments, and not after a backslash:
 * ` >>> ` inside an attribute value or a comment is CSS, not a path.
 *
 * Closed shadow roots are not reachable: no page script can read one (`shadowRoot` is `null`,
 * measured live 2026-09-28 in surf's world and in an isolated world), so a path through a closed
 * host resolves to nothing and nothing here claims otherwise.
 */

/** Between two segments of a shadow path; never part of an emitted segment. */
export const SHADOW_SEPARATOR = " >>> ";

/**
 * The segments of a path. Self-contained on purpose: its own source is the page-side splitter
 * (`SHADOW_QUERY_FUNCTION`), so the page and this module cannot split a path differently.
 */
export function splitShadowPath(path: string): string[] {
  const text = String(path);
  const segments: string[] = [];
  let quote = "";
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
    } else if (quote === "" && text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 1;
    } else if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[" || character === "(") {
      depth += 1;
    } else if (character === "]" || character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && text.startsWith(" >>> ", index)) {
      segments.push(text.slice(start, index));
      start = index + 5;
      index += 4;
    }
  }
  segments.push(text.slice(start));
  return segments;
}

export function isShadowPath(selector: string): boolean {
  return splitShadowPath(selector).length > 1;
}

/** Every segment is non-empty: an empty one would resolve against the wrong root. */
export function isWellFormedShadowPath(selector: string): boolean {
  return splitShadowPath(selector).every((segment) => segment.trim() !== "");
}

/**
 * Page-side `(path) => { found, count }`, a function expression.
 *
 * `count` is how many elements the path reaches: 0 when a segment is not valid CSS, matches
 * nothing, or its one host has no open shadow root; more than 1 when the last segment matches
 * several, or when a host segment does (`found` is then empty: no element was reached through an
 * ambiguous host). A one-segment path is `document.querySelectorAll` and nothing else.
 */
export const SHADOW_QUERY_FUNCTION = `function (path) {
  const segments = (${splitShadowPath.toString()})(path);
  let scope = document;
  for (let index = 0; index < segments.length; index += 1) {
    let found;
    try { found = Array.prototype.slice.call(scope.querySelectorAll(segments[index])); } catch (error) { return { found: [], count: 0 }; }
    if (index === segments.length - 1) return { found: found, count: found.length };
    if (found.length !== 1) return { found: [], count: found.length };
    scope = found[0].shadowRoot;
    if (!scope) return { found: [], count: 0 };
  }
  return { found: [], count: 0 };
}`;

/**
 * Page-side `(path) => Element | null`: the element a read addresses. A plain selector keeps
 * `document.querySelector`'s first match; a shadow path needs exactly one element at every step.
 */
export const SHADOW_ONE_FUNCTION = `function (path) {
  const query = (${SHADOW_QUERY_FUNCTION})(path);
  return (${splitShadowPath.toString()})(path).length === 1 || query.count === 1 ? query.found[0] || null : null;
}`;

/**
 * The expression a CDP act resolves a shadow path with: the element when the path reaches
 * exactly one, otherwise the number it reaches. The marker carries the path for the test fake;
 * a `*` `/` pair in it is escaped so the comment cannot end early.
 */
export function shadowQueryExpression(path: string): string {
  const marker = JSON.stringify(path).replace(/\*\//g, "*\\/");
  return `/* tc:shadow-query ${marker} */ (() => { const query = (${SHADOW_QUERY_FUNCTION})(${JSON.stringify(path)}); return query.count === 1 ? query.found[0] : query.count; })()`;
}
