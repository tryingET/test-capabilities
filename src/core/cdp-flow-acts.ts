/**
 * The acts and reads of `surf flow` on the DevTools connection (AK #6164; design
 * `docs/project/2026-09-28-surf-flow-design.md` sections 4-6).
 *
 * A flow step reaches here as one frame step (`cdp-step-transport.ts`) whose command is
 * `flow.<action>` and whose argument is the payload the flow operation built: the step as the
 * file wrote it, plus the policy the operation decided (the allowlisted origins, and whether this
 * step is an authorized submit). Every act waits for its element as any CDP act does, and then,
 * on the element itself and before any input, refuses a document whose origin is not allowlisted
 * and a form-level control the step may not act on. Reads run in the frame's isolated world.
 */

import type { CdpActions, CdpActionTarget, ElementProbe } from "./cdp-actions.js";
import { DOCUMENT } from "./cdp-element-functions.js";
import { parseChord } from "./cdp-keys.js";
import { FrameworkError } from "./runtime-contract.js";
import { SHADOW_ONE_FUNCTION } from "./shadow-path.js";

/** The commands a flow step runs as; each has a frame form. */
export const FLOW_COMMANDS = [
  "flow.wait",
  "flow.assert",
  "flow.observe",
  "flow.fill",
  "flow.select",
  "flow.check",
  "flow.uncheck",
  "flow.click",
  "flow.press",
] as const;

type Condition =
  | { selector: string }
  | { text: string }
  | { url_prefix: string }
  | { field: { target: string; equals: string } };

/** What the flow operation hands one step: the step's own words and the run's policy. */
export interface FlowActPayload {
  step: string;
  target?: string | { role: string; name: string };
  value?: string;
  key?: string;
  condition?: Condition;
  timeoutMs?: number;
  /** the origins an act may land in: `mutation.allowOrigins` */
  origins: readonly string[];
  /** only an authorized submit step may act on a form-level control */
  submit: "authorized" | "undeclared";
}

/**
 * Page-side, called on what a click reaches: is it a form-level control - the class apply
 * forbids? A click inside a button is the button's - every button-like element on the path, one
 * nested in another included - and a label's click may be its control's: any one gated is gated. "Inside" is the path the click's event takes: through the slot
 * content is assigned to, and out of a shadow root to its host. A frame is gated: a click that
 * reaches one lands somewhere this check cannot see.
 */
export const FLOW_GATE = `function () { /* tc:flow-gate */
  const buttons = 'button,input[type="submit"],input[type="button"],input[type="image"],input[type="reset"],[role="button"]';
  const up = (el) => el.assignedSlot || el.parentElement || (el.getRootNode().host || null);
  const formOf = (el) => { for (let at = el; at; at = up(at)) if (at.form || at.matches('form')) return true; return false; };
  // every button-like element on the path, not the nearest only: one inside another is both
  const gatedFrom = (el) => { for (let at = el; at; at = up(at)) if (at.matches(buttons) && formOf(at)) return true; return false; };
  if (this.tagName === 'IFRAME' || this.tagName === 'FRAME') return true;
  if (gatedFrom(this)) return true;
  for (let at = this; at; at = up(at)) if (at.matches('label') && at.control && gatedFrom(at.control)) return true;
  return false;
}`;

/**
 * Page-side, after a press: the element holding pointer capture (a pointerdown handler may hand it
 * to another element) receives the release and its click, so it is judged as a click on it would
 * be. Found in the document and open roots; a captor inside a closed root is a residual.
 */
export const CAPTOR_GATE = `function () { /* tc:captor-gate */
  const gate = ${FLOW_GATE};
  const roots = [this.ownerDocument];
  for (let at = 0; at < roots.length; at += 1) {
    for (const el of roots[at].querySelectorAll('*')) {
      if (el.hasPointerCapture(1)) return gate.call(el);
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return false;
}`;

/**
 * Page-side, armed after a press passed its checks: a click can still change what it activates
 * as it lands (a mouseup or click handler sets `form=`), so listeners in the isolated world judge
 * the click event's own path at dispatch - before the page's handlers and again after them, at
 * the window, just before activation - and prevent a form-level one. After the page's handlers
 * they also hold the activation of every button on the path, unless it does more than reach a
 * form, and a watch on the path's inputs and buttons prevents the click when a listener makes
 * one a form's submitter. `CLICK_GUARD_END` removes them and says whether a form-level
 * activation was prevented.
 */
export const CLICK_GUARD = `function () { /* tc:click-guard */
  const gate = ${FLOW_GATE};
  const view = this.ownerDocument.defaultView;
  view.__testCapabilitiesFlowBlocked = false;
  view.__testCapabilitiesFlowSubmitters = [];
  const button = (node) =>
    node.tagName === 'BUTTON' ||
    (node.tagName === 'INPUT' && ['submit', 'image', 'reset', 'button'].indexOf(node.type) >= 0);
  const submitting = (node) =>
    (node.tagName === 'BUTTON' && (node.type === 'submit' || node.type === 'reset')) ||
    (node.tagName === 'INPUT' && ['submit', 'image', 'reset'].indexOf(node.type) >= 0);
  // activation submits through the form owner, which the form attribute can name from anywhere
  const owned = (node) => submitting(node) && Boolean(node.form);
  view.__testCapabilitiesFlowOwned = owned;
  // an activation that does more than reach a form: a popover or command target, or a link
  // around the button (Chromium follows it)
  const keeps = (node) =>
    (button(node) && Boolean(node.popoverTargetElement || node.commandForElement)) ||
    (['a', 'area'].indexOf(String(node.tagName).toLowerCase()) >= 0 &&
      (node.hasAttribute('href') || node.hasAttribute('xlink:href')));
  const judge = (event) => {
    // the event's own path, fixed at dispatch: a handler that detached the target hides nothing
    const path = event.composedPath().filter((node) => node && node.nodeType === 1);
    if (path.some((node) => gate.call(node))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      view.__testCapabilitiesFlowBlocked = true;
    }
    return path;
  };
  // a listener may also make an input or a button on the path a form's submitter - a checkbox
  // turned into a submit input, a form given the id a button's form attribute names, a button
  // moved into a form. Any change to the trees they live in is seen as that listener returns
  // (its records arrive in the microtask checkpoint after it, while the click still
  // dispatches), and then every click still dispatching is judged again: one whose path now
  // holds a form's submitter is prevented, and a tree a control was moved into is watched from
  // then on. A handler may dispatch another click inside this one.
  const clicks = [];
  const watched = [];
  let watch;
  // the tree each input and button on a path lives in now - one it was moved into included
  const follow = (path) => {
    for (const node of path) {
      if (node.tagName !== 'INPUT' && node.tagName !== 'BUTTON') continue;
      const root = node.getRootNode();
      if (watched.indexOf(root) >= 0) continue;
      watched.push(root);
      watch.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['type', 'form', 'id'],
      });
    }
  };
  watch = new view.MutationObserver(() => {
    for (const click of clicks) {
      if (click.event.eventPhase === 0) continue;
      follow(click.path);
      for (const node of click.path) {
        if (owned(node)) {
          click.event.preventDefault();
          view.__testCapabilitiesFlowSubmitters.push(node);
        }
      }
    }
  });
  view.__testCapabilitiesFlowWatch = watch;
  view.__testCapabilitiesFlowGuard = (event) => {
    const path = judge(event);
    clicks.push({ event, path });
    follow(path);
  };
  view.__testCapabilitiesFlowHold = (event) => {
    const path = judge(event);
    if (path.some(keeps)) return;
    // after the page's handlers, which saw the click as sent: a button's activation is held
    // whatever type and form it has now - a listener added after this one could change either -
    // and one with no form, or of type button, does nothing when activated anyway
    for (const node of path) {
      if (button(node)) {
        event.preventDefault();
        view.__testCapabilitiesFlowSubmitters.push(node);
      }
    }
  };
  // before the page's handlers, and again after them at the window (a handler may make the
  // control form-level) - activation follows the dispatch, and a prevented click is not activated
  view.addEventListener('click', view.__testCapabilitiesFlowGuard, true);
  view.addEventListener('click', view.__testCapabilitiesFlowHold, false);
  return true;
}`;
export const CLICK_GUARD_END = `function () { /* tc:click-guard-end */
  const view = this.ownerDocument.defaultView;
  view.removeEventListener('click', view.__testCapabilitiesFlowGuard, true);
  view.removeEventListener('click', view.__testCapabilitiesFlowHold, false);
  view.__testCapabilitiesFlowWatch.disconnect();
  return (
    view.__testCapabilitiesFlowBlocked === true ||
    view.__testCapabilitiesFlowSubmitters.some(view.__testCapabilitiesFlowOwned)
  );
}`;

/**
 * Enter and Space activate what holds focus - submit a form, press a button - and a focus handler,
 * a closed shadow root or a frame can put focus where no check can follow; an Alt chord may be an
 * access key. So a key press that sends one is a form-level act whatever the target is.
 */
export function isActivationKey(chord: string): boolean {
  const { key, modifiers } = parseChord(chord);
  // an Alt chord may be an access key, which activates the element that carries it
  if (modifiers.some((modifier) => modifier.key === "Alt")) return true;
  return key.key === "Enter" || key.key === " " || key.text === "\r" || key.text === "\n";
}

const originOf = (href: string): string => (URL.canParse(href) ? new URL(href).origin : href);

/**
 * The guard an act runs on its element just before input. It returns the element's document URL
 * (where the act started, for a submit's `left_url`).
 */
function guard(payload: FlowActPayload, key: string | null) {
  const seen: { href?: string; probe?: ElementProbe } = {};
  // a click is gated at a form-level control, or on a path a closed shadow root may redirect
  const clickGated = async (probe: ElementProbe) =>
    (await probe.reached<boolean>(FLOW_GATE)) || (await probe.closedShadow());
  // after the press, judged again: a mousedown handler may have made the control form-level
  const afterPress = async () => {
    if (payload.submit === "authorized" || !seen.probe) return;
    // a check that cannot judge after the press judges gated: the press is sent either way;
    // the release goes to the pointer's captor when a handler took capture, so it is judged too
    const probe = seen.probe;
    const gated = async () => (await clickGated(probe)) || (await probe.call<boolean>(CAPTOR_GATE));
    // not gated: the click is let go, with a guard that judges it once more as it lands
    if (
      !(await gated().catch(() => true)) &&
      (await probe.call<boolean>(CLICK_GUARD).catch(() => false))
    ) {
      return;
    }
    throw new FrameworkError(
      "flow_submit_cancelled",
      `Flow step ${payload.step}: the press made it form-level (a mousedown handler), so the click was released away from it; the press itself was sent.`,
      { step: payload.step },
    );
  };
  const afterRelease = async () => {
    if (payload.submit === "authorized" || !seen.probe) return;
    // a document the click navigated away holds no guard, and nothing it prevented
    if (!(await seen.probe.call<boolean>(CLICK_GUARD_END).catch(() => false))) return;
    throw new FrameworkError(
      "flow_submit_cancelled",
      `Flow step ${payload.step}: the click reached a form-level control as it landed, and was prevented there; the press and release were sent.`,
      { step: payload.step },
    );
  };
  const before = async (probe: ElementProbe) => {
    seen.probe = probe;
    const href = await probe.call<string>(DOCUMENT);
    seen.href = href;
    const origin = originOf(href);
    if (!payload.origins.includes(origin)) {
      // the origin, never the URL: a page may put a value it was given into its URL
      throw new FrameworkError(
        "mutation_origin_not_allowed",
        `Refusing to act on ${origin}: mutation.allowOrigins does not name it (flow step ${payload.step}). Nothing was sent.`,
        { step: payload.step, origin },
      );
    }
    if (payload.submit === "authorized") return;
    const gated = key === null ? await clickGated(probe) : isActivationKey(payload.key as string);
    // any other key may still cause a click (a keydown handler): judged as it lands
    const armed =
      gated || key === null || (await probe.call<boolean>(CLICK_GUARD).catch(() => false));
    if (gated || !armed) {
      throw new FrameworkError(
        "flow_submit_undeclared",
        `Flow step ${payload.step} would ${key === null ? "click a form-level control, which submits or acts for a form" : `press ${key === " " ? "Space" : key}, which activates whatever holds focus`}. Only a step declared 'submit: true', run with --submit and the flow's approval token, may do that. Nothing was sent.`,
        { step: payload.step },
      );
    }
  };
  return { before, afterPress, afterRelease, seen };
}

const conditionScript = (condition: Condition): string => `(() => {
  const one = ${SHADOW_ONE_FUNCTION};
  const condition = ${JSON.stringify(condition)};
  const body = document.body && typeof document.body.innerText === 'string' ? document.body.innerText : '';
  let held = false;
  if (condition.selector !== undefined) {
    const el = one(condition.selector);
    const box = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    const style = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    held = Boolean(el && box && box.width > 0 && box.height > 0 && !(style && style.visibility === 'hidden'));
  } else if (condition.text !== undefined) {
    held = body.indexOf(condition.text) >= 0;
  } else if (condition.url_prefix !== undefined) {
    held = location.href.indexOf(condition.url_prefix) === 0;
  } else {
    const el = one(condition.field.target);
    const actual = el && (el.type === 'checkbox' || el.type === 'radio') ? String(el.checked === true) : el ? String(el.value === undefined || el.value === null ? '' : el.value) : null;
    held = actual === condition.field.equals;
  }
  return { held: held, href: location.href };
})()`;

const POLL_MS = 50;
const DEFAULT_TIMEOUT_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A select's refusal names the step, never the value it was asked for: values stay out of records. */
async function selectWithoutValue(
  actions: CdpActions,
  target: CdpActionTarget,
  payload: FlowActPayload,
  options: Parameters<CdpActions["select"]>[2],
): Promise<void> {
  try {
    await actions.select(target, payload.value ?? "", options);
  } catch (error) {
    if (!(error instanceof FrameworkError) || error.code !== "action_option_not_found") throw error;
    throw new FrameworkError(
      "action_option_not_found",
      `Flow step ${payload.step}: the select offers no option with the step's value or label; nothing was selected.`,
      { step: payload.step },
    );
  }
}

/** Run one flow step's command in `frame` on held (or per-step) actions. */
export async function runFlowAct(
  actions: CdpActions,
  command: string,
  payload: FlowActPayload,
  frame: string,
): Promise<unknown> {
  if (command === "flow.wait" || command === "flow.assert" || command === "flow.observe") {
    const read = () =>
      actions.evaluate<{ held: boolean; href: string }>(
        conditionScript(payload.condition as Condition),
        { frame, world: "isolated" },
      );
    let answer = await read();
    if (command !== "flow.wait") {
      if (command === "flow.assert" && !answer.held) {
        throw new FrameworkError(
          "flow_assertion_failed",
          `Flow step ${payload.step}: the assertion does not hold on ${originOf(answer.href)}.`,
          { step: payload.step },
        );
      }
      return answer;
    }
    const deadline = Date.now() + (payload.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    while (!answer.held && Date.now() < deadline) {
      await sleep(POLL_MS);
      answer = await read();
    }
    if (!answer.held) {
      throw new FrameworkError(
        "flow_wait_timeout",
        `Flow step ${payload.step}: the condition did not hold within ${payload.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms on ${originOf(answer.href)}.`,
        { step: payload.step },
      );
    }
    return answer;
  }

  const target: CdpActionTarget =
    typeof payload.target === "string"
      ? { selector: payload.target, frame }
      : { ...(payload.target as { role: string; name: string }), frame };
  const key = command === "flow.press" ? parseChord(payload.key as string).key.key : null;
  const { before, afterPress, afterRelease, seen } = guard(payload, key);
  const options = {
    before,
    afterPress,
    afterRelease,
    ...(payload.timeoutMs ? { timeoutMs: payload.timeoutMs } : {}),
  };
  if (command === "flow.fill") await actions.fill(target, payload.value ?? "", options);
  else if (command === "flow.select") await selectWithoutValue(actions, target, payload, options);
  else if (command === "flow.check") await actions.check(target, options);
  else if (command === "flow.uncheck") await actions.uncheck(target, options);
  else if (command === "flow.click") await actions.click(target, options);
  else await actions.press(payload.key as string, { ...options, target });
  return { href: seen.href ?? null };
}
