/**
 * What a CDP action runs on a resolved element (`Runtime.callFunctionOn`), and the document check
 * an act makes on that element just before input (CDP program S1/S3). Each page-side function
 * carries a `tc:` marker comment the test fake dispatches on, never on its body.
 */

import { FrameworkError } from "./runtime-contract.js";

export const SELECT_ALL =
  "function () { /* tc:select-all */ if (typeof this.select === 'function') this.select(); }";
/**
 * Choose an option by value or label, and announce it. A select inside a shadow root announces
 * `input` composed, as the browser's own does, so a listener outside that root hears it (AK
 * #6163); a document select's events are exactly what they were. `change` is never composed.
 */
export const SELECT_OPTION = `function (wanted) { /* tc:select-option */
  const option = [...this.options].find((o) => o.value === wanted || o.label === wanted);
  if (!option) return false;
  this.value = option.value;
  const inShadow = this.getRootNode() !== this.ownerDocument;
  this.dispatchEvent(new Event("input", inShadow ? { bubbles: true, composed: true } : { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}`;
export const CONNECTED = "function () { /* tc:connected */ return this.isConnected; }";
export const DOCUMENT =
  "function () { /* tc:document */ return this.ownerDocument.location.href; }";
const withoutFragment = (href: string) => href.split("#")[0];

/** Refuse, before any input, an element or a frame whose document is not one of `documents`. */
export function assertDocument(
  href: string,
  documents: readonly string[],
  what: string,
  exact = false,
): void {
  const matches = exact
    ? documents.includes(href)
    : documents.map(withoutFragment).includes(withoutFragment(href));
  if (!matches) {
    throw new FrameworkError(
      "action_document_changed",
      `the document is ${href}, not ${documents.join(" or ")}; ${what}`,
      { href, documents: [...documents] },
    );
  }
}
