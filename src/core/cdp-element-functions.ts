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
/**
 * Before a press is released away from its control (a dialog opened, or the press changed what
 * the release would complete): let go of any pointer capture a handler took - a captured release
 * still reaches its captor - and block the one click the release may still dispatch. It runs in
 * an isolated world, whose listener and global the page cannot see; `UNCANCEL_CLICK` removes it.
 */
export const CANCEL_CLICK = `function () { /* tc:cancel-click */
  const doc = this.ownerDocument;
  const roots = [doc];
  for (let at = 0; at < roots.length; at += 1) {
    for (const el of roots[at].querySelectorAll('*')) {
      if (el.hasPointerCapture(1)) el.releasePointerCapture(1);
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  const view = doc.defaultView;
  view.__testCapabilitiesClickBlock = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  view.addEventListener('click', view.__testCapabilitiesClickBlock, true);
  return true;
}`;
export const UNCANCEL_CLICK = `function () { /* tc:uncancel-click */
  const view = this.ownerDocument.defaultView;
  view.removeEventListener('click', view.__testCapabilitiesClickBlock, true);
  return true;
}`;

/** The element holding the mouse's pointer capture (document and open roots), or null. */
export const FIND_CAPTOR = `function () { /* tc:find-captor */
  const roots = [this.ownerDocument];
  for (let at = 0; at < roots.length; at += 1) {
    for (const el of roots[at].querySelectorAll('*')) {
      if (el.hasPointerCapture(1)) return el;
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return null;
}`;

/**
 * The elements a click's event path runs through, from the element up: into the slot it is
 * assigned to, out of a shadow root to its host, up to the document. A slot in a closed root is
 * not visible from here, which is why its hosts are asked over CDP (`closedShadowOnPath`).
 */
export const CLICK_PATH = `function () { /* tc:click-path */
  const path = [];
  for (let el = this; el; el = el.assignedSlot || el.parentElement || el.getRootNode().host || null) path.push(el);
  return path;
}`;

/**
 * Whether focus is still on the element after it was focused: its document holds the page's focus
 * (not another frame: measured live 2026-09-28, `hasFocus()` answers per frame with the window
 * unfocused), and in its own tree scope, and each shadow host up to the document, focus is on it.
 * A focus handler that moved focus on - to another field, into or out to another frame - fails it.
 */
export const FOCUS_KEPT = `function () { /* tc:focus-kept */
  if (!this.ownerDocument.hasFocus()) return false;
  for (let el = this; el; ) {
    const root = el.getRootNode();
    if (root.activeElement !== el) return false;
    el = root.host || null;
  }
  return true;
}`;
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
