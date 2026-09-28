/**
 * The page-side expression behind `surf plan` and the apply-time drift check (submit-gate packet
 * §4.1, §4.2): it reads a form's fields, their identity, the buttons around them and the layout,
 * and returns facts. It decides nothing; `surf-plan-probe.ts` does, in TypeScript.
 *
 * Fields may live in open shadow roots (AK #6163). `label:` and `name:` look in the document and
 * every open root, nested ones included; `selector:` and the submit selector are exact shadow
 * paths (`shadow-path.ts`). Every selector the probe derives is a path whose each segment is
 * unique in its own root. `formCount` and `frameCount` stay the document's own, so a plan with no
 * shadow path fingerprints exactly as before. A closed root is `null` to every page script: the
 * probe cannot search it, and says how many open roots it did search.
 *
 * The script is declared `read_only`, so the session checks it against the `js` denylist before
 * a process exists: it never assigns to a document property, a field value or `location`, and
 * never calls `click`, `submit`, `dispatchEvent` or `fetch`.
 */

import { SHADOW_QUERY_FUNCTION, SHADOW_SEPARATOR, splitShadowPath } from "./shadow-path.js";
import type { FieldLocator } from "./surf-plan.js";

export const SURF_PLAN_PROBE_FIELD = "__testCapabilitiesSurfPlanProbe";

export interface PlanProbeFieldRequest {
  id: string;
  locator: FieldLocator;
}

export interface PlanProbeRequest {
  fields: readonly PlanProbeFieldRequest[];
  submitText?: string;
  submitSelector?: string;
}

/**
 * The probe expression. Every value it embeds is JSON, so a selector or a label carrying a
 * quote cannot end the string it sits in.
 */
export function buildPlanProbeScript(probeId: string, request: PlanProbeRequest): string {
  const spec = JSON.stringify({
    probeId,
    fields: request.fields.map((field) => ({
      id: field.id,
      kind: field.locator.kind,
      value: field.locator.value,
    })),
    submitSelector: request.submitSelector ?? null,
    submitText: request.submitText ?? null,
  });

  return `(() => {
  const spec = ${spec};
  const separator = ${JSON.stringify(SHADOW_SEPARATOR)};
  const split = ${splitShadowPath.toString()};
  const query = ${SHADOW_QUERY_FUNCTION};
  const norm = (value) => String(value === null || value === undefined ? '' : value).replace(/\\s+/g, ' ').trim();
  const within = (root, selector) => { try { return Array.prototype.slice.call(root.querySelectorAll(selector)); } catch (error) { return []; } };
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    within(roots[index], '*').forEach((el) => { if (el.shadowRoot) roots.push(el.shadowRoot); });
  }
  const all = (selector) => within(document, selector);
  const deep = (selector) => roots.reduce((found, root) => found.concat(within(root, selector)), []);
  const rootOf = (el) => (el && typeof el.getRootNode === 'function' ? el.getRootNode() : document);
  const tagOf = (el) => norm(el && el.tagName).toLowerCase();
  const attr = (el, name) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
  const typeOf = (el) => { const value = norm(el && el.type).toLowerCase(); return value === '' ? null : value; };
  const idSelector = (el) => { const id = el && el.id; return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ? '#' + id : null; };
  const segmentFor = (el, fallback, host) => {
    const candidates = [];
    const byId = idSelector(el);
    if (byId) candidates.push(byId);
    const name = typeof el.name === 'string' ? el.name : '';
    if (/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) candidates.push(tagOf(el) + '[name="' + name + '"]');
    if (fallback) candidates.push(fallback);
    if (host) candidates.push(tagOf(el));
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (split(candidate).length !== 1) continue;
      const found = within(rootOf(el), candidate);
      if (found.length === 1 && found[0] === el) return candidate;
    }
    return null;
  };
  const selectorFor = (el, hints) => {
    if (!el) return null;
    const chain = [el];
    let root = rootOf(el);
    while (root && root.host) { chain.unshift(root.host); root = rootOf(root.host); }
    if (root !== document) return null;
    const fallbacks = hints && hints.length === chain.length ? hints : [];
    const parts = chain.map((node, index) => segmentFor(node, fallbacks[index] || null, index < chain.length - 1));
    return parts.every((part) => part !== null) ? parts.join(separator) : null;
  };
  const visible = (el) => {
    if (!el) return false;
    if (el.hidden === true) return false;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (rect) return rect.width > 0 || rect.height > 0;
    return el.offsetParent !== null && el.offsetParent !== undefined;
  };
  const buttonLike = (el) => {
    const tag = tagOf(el);
    if (tag === 'button' || tag === 'a') return true;
    if (norm(attr(el, 'role')).toLowerCase() === 'button') return true;
    if (tag === 'input') { const type = typeOf(el) || 'text'; return ['submit', 'button', 'image', 'reset'].indexOf(type) >= 0; }
    return false;
  };
  const textOf = (el) => {
    const label = norm(attr(el, 'aria-label'));
    if (label !== '') return label;
    const own = norm(el && el.textContent);
    if (own !== '') return own;
    if (tagOf(el) === 'input') return norm(attr(el, 'value'));
    return '';
  };
  const fieldsSelector = 'input,textarea,select';
  const controlSelector = 'button,input[type="submit"],input[type="button"],input[type="image"],input[type="reset"],[role="button"]';
  // a <label> outranks an aria-label within its own root only: a match in another root is another
  // candidate, never a reason to drop this one
  const labelled = (text) => roots.reduce((found, root) => {
    const byLabel = within(root, 'label')
      .filter((el) => norm(el.textContent) === norm(text))
      .map((el) => el.control || (el.htmlFor ? rootOf(el).getElementById(el.htmlFor) : null))
      .filter((el) => el !== null && el !== undefined);
    return found.concat(byLabel.length > 0 ? byLabel : within(root, fieldsSelector).filter((el) => norm(attr(el, 'aria-label')) === norm(text)));
  }, []);
  const resolve = (field) => {
    if (field.kind === 'selector') return query(field.value);
    const found = field.kind === 'name'
      ? deep(fieldsSelector).filter((el) => typeof el.name === 'string' && el.name === field.value)
      : labelled(field.value);
    return { found: found, count: found.length };
  };
  const resolved = spec.fields.map((field) => {
    const matches = resolve(field);
    const el = matches.count === 1 ? matches.found[0] : null;
    return {
      id: field.id,
      element: el,
      report: {
        id: field.id,
        matches: matches.count,
        selector: el ? selectorFor(el, field.kind === 'selector' ? split(field.value) : null) : null,
        tag: el ? tagOf(el) : '',
        type: el ? typeOf(el) : null,
        name: el && typeof el.name === 'string' && el.name !== '' ? el.name : null,
        form: el && el.form ? selectorFor(el.form, null) : null,
        value: el && typeof el.value === 'string' ? el.value : '',
        checked: Boolean(el && el.checked),
        buttonLike: el ? buttonLike(el) : false,
      },
    };
  });
  const owner = resolved.map((entry) => entry.element).filter((el) => el)[0];
  const owningForm = owner && owner.form ? owner.form : null;
  const submitMatches = spec.submitSelector ? query(spec.submitSelector).found : [];
  const controlNodes = deep(controlSelector);
  const scope = controlNodes.concat(submitMatches.filter((el) => controlNodes.indexOf(el) < 0));
  const controls = scope.map((el) => {
    const tag = tagOf(el);
    const type = typeOf(el);
    const inOwningForm = Boolean(owningForm && el.form === owningForm);
    let candidateKind = null;
    if (tag === 'button' && (type === 'submit' || type === null)) candidateKind = type === 'submit' ? 'explicit_submit' : 'implicit_submit';
    if (tag === 'input' && type === 'submit') candidateKind = 'explicit_submit';
    return {
      selector: selectorFor(el, null),
      text: textOf(el),
      tag: tag,
      type: type,
      disabled: el.disabled === true,
      visible: visible(el),
      inOwningForm: inOwningForm,
      candidateKind: candidateKind,
      matchesSubmitSelector: submitMatches.indexOf(el) >= 0,
      buttonLike: buttonLike(el),
    };
  });
  return {
    ${SURF_PLAN_PROBE_FIELD}: spec.probeId,
    href: location.href,
    title: document.title,
    formCount: all('form').length,
    frameCount: all('iframe').length,
    shadowRoots: roots.length - 1,
    fields: resolved.map((entry) => entry.report),
    controls: controls,
  };
})()`;
}
