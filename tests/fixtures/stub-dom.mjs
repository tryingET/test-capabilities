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

export function stubDocument(page) {
  const forms = new Map();
  const formNode = (selector) => {
    if (!selector) return null;
    if (!forms.has(selector)) {
      forms.set(
        selector,
        domNode({ tagName: "FORM", selector, id: idFromSelector(selector, undefined) }),
      );
    }
    return forms.get(selector);
  };
  for (const selector of formSelectorsOf(page.fields, page.controls)) {
    formNode(selector);
  }

  const anchors = page.links.map((href) =>
    domNode({ tagName: "A", href, selector: null, textContent: href }),
  );
  const repeat = (count, tagName) =>
    Array.from({ length: count }, () => domNode({ tagName, selector: null }));

  const fieldNodes = Object.entries(page.fields).map(([selector, field]) =>
    domNode({
      tagName: (field.kind || "text") === "select" ? "SELECT" : "INPUT",
      type: field.kind || "text",
      value: field.value ?? "",
      checked: field.checked ?? false,
      name: field.name,
      id: idFromSelector(selector, field.id),
      ariaLabel: field.ariaLabel,
      hidden: field.hidden === true,
      disabled: field.disabled === true,
      form: formNode(field.form),
      selector,
    }),
  );

  const controlNodes = page.controls.map((control) =>
    domNode({
      tagName: control.tag ? String(control.tag).toUpperCase() : "BUTTON",
      type: control.kind,
      textContent: control.text ?? "",
      disabled: control.enabled === false,
      visible: control.visible,
      name: control.name,
      id: idFromSelector(control.selector, control.id),
      role: control.role,
      form: formNode(control.form),
      selector: control.selector,
    }),
  );

  const labelNodes = Object.entries(page.fields)
    .filter(([, field]) => typeof field.label === "string" && field.label !== "")
    .map(([selector, field]) =>
      domNode({
        tagName: "LABEL",
        textContent: field.label,
        selector: null,
        control: fieldNodes.find((node) => node.selector === selector) ?? null,
      }),
    );

  const iframeNodes = page.frames.map((frame) =>
    domNode({ tagName: "IFRAME", selector: null, src: frame.src }),
  );

  const all = [
    ...fieldNodes,
    ...controlNodes,
    ...labelNodes,
    ...anchors,
    ...iframeNodes,
    ...forms.values(),
  ];

  return {
    title: page.title,
    readyState: page.readyState,
    getElementById(id) {
      return all.find((node) => node.id === id) ?? null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const parsed = parseSelector(selector);
      const matched = all.filter((node) =>
        parsed.some((part) => matchesSimpleSelector(node, part)),
      );
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
}

/** The defaults `fake-surf.mjs`'s `pageFor` fills, for a page model written by hand. */
export function normalizeStubPage(model, url) {
  const fields = model.fields ?? {};
  const controls = model.controls ?? [];
  const links = model.links ?? [];
  const frames = model.frames ?? [];
  return {
    url,
    title: model.title ?? "Fake page",
    readyState: model.readyState ?? "complete",
    links,
    frames,
    fields,
    controls,
    counts: {
      anchors: links.length,
      buttons: controls.length > 0 ? controls.length : 1,
      forms: formSelectorsOf(fields, controls).length,
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
