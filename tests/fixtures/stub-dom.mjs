import vm from "node:vm";

/**
 * The DOM stub both fakes evaluate page-side scripts against: the fake `surf` for `js`, and the
 * fake DevTools endpoint (`tests/helpers/fake-cdp-dom.mjs`) for a frame that carries a `form`
 * page model. One stub, so a plan or apply script reads a form in a frame exactly the way it
 * reads one in the top document.
 *
 * A page model here is the normalised one `fake-surf.mjs` builds in `pageFor`: `{ url, title,
 * readyState, links, frames, fields, controls, counts }`; {@link normalizeStubPage} fills the
 * defaults for a model written by hand.
 */

/** Between two segments of a shadow path, as `src/core/shadow-path.ts` writes it. */
export const SHADOW_SEPARATOR = " >>> ";

/** A form counted by `document.querySelectorAll("form")`: one in no shadow root. */
export function documentFormCount(fields, controls) {
  return formSelectorsOf(fields, controls).filter((form) => !form.includes(SHADOW_SEPARATOR))
    .length;
}

/** Every distinct owning form named by a field or a control, in declaration order. */
export function formSelectorsOf(fields, controls) {
  const seen = [];
  for (const field of Object.values(fields)) {
    if (field.form && !seen.includes(field.form)) seen.push(field.form);
  }
  for (const control of controls) {
    if (control.form && !seen.includes(control.form)) seen.push(control.form);
  }
  return seen;
}

/**
 * A DOM stub with a small selector engine.
 *
 * The plan probe of the submit gate reads a form the way a browser presents one - tag names,
 * `[name="..."]`, `#id`, `<label>` and its `control`, `el.form`, layout boxes - so the fixture
 * has to model those, not a lookup table of selector strings. What is modelled is a documented
 * subset: comma lists, a tag name, `#id`, `[attr="value"]` and `tag[attr="value"]`, plus the
 * page model's own selector key as an exact match. Anything else matches nothing, which is the
 * fail-closed direction: a probe that needs more than this fails loudly in a test rather than
 * quietly passing against a fixture that guessed.
 */
function parseSelector(selector) {
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const attributes = [];
      let rest = part;
      let id = null;
      rest = rest.replace(
        /\[([A-Za-z_:][-\w:.]*)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]/g,
        (_, name, operator, value) => {
          attributes.push({ name, value: operator ? value : undefined });
          return "";
        },
      );
      rest = rest.replace(/#([A-Za-z][-\w]*)/, (_, value) => {
        id = value;
        return "";
      });
      const tag = rest.trim().toLowerCase();
      return { raw: part, tag: tag === "" || tag === "*" ? null : tag, id, attributes };
    });
}

function nodeAttribute(node, name) {
  if (name === "name") return node.name;
  if (name === "id") return node.id;
  if (name === "type") return node.type;
  if (name === "href") return node.href;
  if (name === "role") return node.role;
  if (name === "value") return node.value;
  if (name === "aria-label") return node.ariaLabel;
  return undefined;
}

function matchesSimpleSelector(node, parsed) {
  if (parsed.raw === "*") return true;
  if (node.selector && node.selector === parsed.raw) return true;
  if (parsed.tag && String(node.tagName || "").toLowerCase() !== parsed.tag) return false;
  if (parsed.id && node.id !== parsed.id) return false;
  for (const attribute of parsed.attributes) {
    const actual = nodeAttribute(node, attribute.name);
    if (actual === undefined || actual === null || actual === "") return false;
    if (attribute.value !== undefined && String(actual) !== attribute.value) return false;
  }
  return parsed.tag !== null || parsed.id !== null || parsed.attributes.length > 0;
}

function domNode(base) {
  const node = {
    id: undefined,
    name: undefined,
    type: undefined,
    role: undefined,
    ariaLabel: undefined,
    textContent: "",
    hidden: false,
    disabled: false,
    ...base,
  };
  node.getAttribute = (attribute) => {
    const value = nodeAttribute(node, attribute);
    return value === undefined ? null : value;
  };
  node.getBoundingClientRect = () =>
    node.hidden || node.visible === false ? { width: 0, height: 0 } : { width: 120, height: 24 };
  node.offsetParent = node.hidden || node.visible === false ? null : {};
  return node;
}

function idFromSelector(selector, declared) {
  if (declared) return declared;
  const match = /^#([A-Za-z][-\w]*)$/.exec(String(selector));
  return match ? match[1] : undefined;
}

/**
 * A root: the document or a shadow root. Each holds its own nodes; `querySelectorAll` answers
 * from them alone, as a real root does (a query never crosses into a shadow root).
 */
function stubRoot(host) {
  const root = {
    host,
    nodes: [],
    getElementById(id) {
      return root.nodes.find((node) => node.id === id) ?? null;
    },
    querySelector(selector) {
      return root.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const parsed = parseSelector(selector);
      return root.nodes.filter((node) => parsed.some((part) => matchesSimpleSelector(node, part)));
    },
  };
  return root;
}

/**
 * A page model's selector keys may be shadow paths (`#host >>> #card`): each segment before the
 * last is a host in the root before it, holding an open shadow root unless the page lists its
 * path in `closedShadowHosts`; `shadowHosts[path].tag` names a host's tag. A node's `selector`
 * is its own last segment, matched within its own root.
 */
export function stubDocument(page) {
  const documentRoot = stubRoot(null);
  const hosts = new Map();
  const closed = new Set(page.closedShadowHosts ?? []);
  // nodes are listed in this order within a root, whatever order they were made in
  const RANK = ["INPUT", "SELECT", "BUTTON", "LABEL", "A", "IFRAME", "FORM"];
  const place = (node, root) => {
    node.getRootNode = () => (root === documentRoot ? documentObject : root);
    node.rank = node.fieldLike ? 0 : node.controlLike ? 1 : RANK.indexOf(node.tagName) + 2 || 99;
    root.nodes.push(node);
    return node;
  };
  const hostOf = (path) => {
    if (hosts.has(path)) return hosts.get(path);
    const segments = path.split(SHADOW_SEPARATOR);
    const segment = segments[segments.length - 1];
    const parent =
      segments.length > 1 ? hostOf(segments.slice(0, -1).join(SHADOW_SEPARATOR)) : null;
    const parsed = parseSelector(segment)[0] ?? { tag: null, id: null };
    const node = domNode({
      tagName: String(parsed.tag ?? page.shadowHosts?.[path]?.tag ?? "div").toUpperCase(),
      id: parsed.id ?? undefined,
      selector: segment,
    });
    node.inner = stubRoot(node);
    node.shadowRoot = closed.has(path) ? null : node.inner;
    place(node, parent ? parent.inner : documentRoot);
    hosts.set(path, node);
    return node;
  };
  // where a key's node lives, and the key's own last segment
  const placed = (key) => {
    const segments = String(key).split(SHADOW_SEPARATOR);
    const own = segments[segments.length - 1];
    const root =
      segments.length > 1
        ? hostOf(segments.slice(0, -1).join(SHADOW_SEPARATOR)).inner
        : documentRoot;
    return { own, root };
  };
  const forms = new Map();
  const formNode = (selector) => {
    if (!selector) return null;
    if (!forms.has(selector)) {
      const { own, root } = placed(selector);
      forms.set(
        selector,
        place(
          domNode({ tagName: "FORM", selector: own, id: idFromSelector(own, undefined) }),
          root,
        ),
      );
    }
    return forms.get(selector);
  };
  for (const selector of formSelectorsOf(page.fields, page.controls)) {
    formNode(selector);
  }

  const anchors = page.links.map((href) =>
    place(domNode({ tagName: "A", href, selector: null, textContent: href }), documentRoot),
  );
  const repeat = (count, tagName) =>
    Array.from({ length: count }, () => domNode({ tagName, selector: null }));

  const fieldNodes = Object.entries(page.fields).map(([selector, field]) => {
    const { own, root } = placed(selector);
    return place(
      domNode({
        tagName: (field.kind || "text") === "select" ? "SELECT" : "INPUT",
        type: field.kind || "text",
        value: field.value ?? "",
        checked: field.checked ?? false,
        name: field.name,
        id: idFromSelector(own, field.id),
        ariaLabel: field.ariaLabel,
        hidden: field.hidden === true,
        disabled: field.disabled === true,
        form: formNode(field.form),
        selector: own,
        key: selector,
        fieldLike: true,
      }),
      root,
    );
  });

  for (const control of page.controls) {
    const { own, root } = placed(control.selector);
    place(
      domNode({
        tagName: control.tag ? String(control.tag).toUpperCase() : "BUTTON",
        type: control.kind,
        textContent: control.text ?? "",
        disabled: control.enabled === false,
        visible: control.visible,
        name: control.name,
        id: idFromSelector(own, control.id),
        role: control.role,
        form: formNode(control.form),
        selector: own,
        controlLike: true,
      }),
      root,
    );
  }

  for (const [selector, field] of Object.entries(page.fields)) {
    if (typeof field.label !== "string" || field.label === "") continue;
    const control = fieldNodes.find((node) => node.key === selector) ?? null;
    place(
      domNode({ tagName: "LABEL", textContent: field.label, selector: null, control }),
      placed(selector).root,
    );
  }

  for (const frame of page.frames) {
    place(domNode({ tagName: "IFRAME", selector: null, src: frame.src }), documentRoot);
  }

  for (const root of [documentRoot, ...[...hosts.values()].map((host) => host.inner)]) {
    root.nodes.sort((a, b) => a.rank - b.rank);
  }

  const documentObject = {
    title: page.title,
    readyState: page.readyState,
    getElementById(id) {
      return documentRoot.getElementById(id);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const matched = documentRoot.querySelectorAll(selector);
      if (matched.length > 0) return matched;
      // Pages that declare only counts (the S3 capture corpus) still answer count queries.
      const text = String(selector);
      if (text.startsWith("a[href]")) return anchors;
      if (text.startsWith("button")) return repeat(page.counts.buttons, "BUTTON");
      if (text.startsWith("form")) return repeat(page.counts.forms, "FORM");
      if (text.startsWith("input")) return repeat(page.counts.inputs, "INPUT");
      if (text.startsWith("iframe")) return repeat(page.counts.iframes, "IFRAME");
      return [];
    },
  };
  return documentObject;
}

/**
 * The document time origin both fakes report for a page, unless its model names another: the
 * DevTools channel proves a target is the owned tab by it, so the same page in both fakes agrees
 * and a test models "another tab at the same URL" with a different `timeOrigin`.
 */
export const DEFAULT_TIME_ORIGIN = 1790000000000.5;

/** The defaults `fake-surf.mjs`'s `pageFor` fills, for a page model written by hand. */
export function normalizeStubPage(model, url) {
  const fields = model.fields ?? {};
  const controls = model.controls ?? [];
  const links = model.links ?? [];
  const frames = model.frames ?? [];
  return {
    url,
    shadowHosts: model.shadowHosts,
    closedShadowHosts: model.closedShadowHosts,
    title: model.title ?? "Fake page",
    readyState: model.readyState ?? "complete",
    links,
    frames,
    fields,
    controls,
    counts: {
      anchors: links.length,
      buttons: controls.length > 0 ? controls.length : 1,
      forms: documentFormCount(fields, controls),
      inputs: Object.keys(fields).length,
      iframes: frames.length,
      ...(model.counts ?? {}),
    },
  };
}

/**
 * Evaluate `code` against the page, expression mode first and statement mode second - the order
 * surf's CLI uses. A script that throws throws here, with the page's message.
 */
export function runInStub(code, page, globals = {}) {
  const sandbox = {
    performance: { timeOrigin: page.timeOrigin ?? DEFAULT_TIME_ORIGIN },
    document: stubDocument(page),
    location: { href: page.url, origin: new URL(page.url).origin },
    URL,
    Set,
    Array,
    console,
    ...globals,
  };
  const context = vm.createContext(sandbox);
  try {
    return vm.runInContext(`(() => { 'use strict'; return (\n${code}\n); })()`, context);
  } catch (error) {
    // vm contexts have their own SyntaxError class; compare by name.
    if (!(error instanceof SyntaxError) && error?.name !== "SyntaxError") throw error;
  }
  return vm.runInContext(`(() => { 'use strict'; ${code} })()`, context);
}
