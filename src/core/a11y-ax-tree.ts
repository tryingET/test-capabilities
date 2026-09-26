/**
 * Rendering Chromium's own accessibility tree as `a11y-snapshot.v1` (AK #5915, measured series
 * 2026-09-26, `docs/project/2026-09-26-a11y-producer-switch.md`).
 *
 * The producer reads `Accessibility.getFullAXTree` over CDP for the page and, through one
 * flattened session each, for every out-of-process frame below it. Chromium's tree is the
 * authority on what assistive technology is told: it computes the accessible name and role, it
 * sees into shadow roots, and it marks what is ignored. Measured on the reference pages, surf's
 * content-script tree agreed on 86% of the GitHub releases page and missed 964 shadow-root buttons
 * on MDN; this tree does neither.
 *
 * Pure ring: the rendering is a function of the recorded nodes. Two rules make it a stable digest
 * input:
 *   - **Structure only.** Controls, headings, landmarks, named images and frames are kept.
 *     Wrapper and text roles are collapsed (the consensus of the agent-browser, Stagehand and
 *     VibeBrowser serializers), and `form`/`region` count as landmarks only with a name, as ARIA
 *     says.
 *   - **Refs are document order, not backend ids.** `eN` numbers the kept nodes in traversal
 *     order, so a reload that leaves the tree the same leaves the text byte-identical. The
 *     backend node id a check needs stays in a handle map that never enters the text.
 */

import type { A11yRefMap } from "./a11y-snapshot.js";

/** One node as `Accessibility.getFullAXTree` answers it, trimmed to what the rendering reads. */
export interface AxRawNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
}

/** The page (`frame: "main"`) or one out-of-process frame read through its own session. */
export interface AxFrameTree {
  frame: string;
  url: string;
  nodes: AxRawNode[];
  /** set when the frame's session attached but its tree could not be read */
  error?: string;
}

/** Where a ref's element lives, so a read-only check can resolve it; never part of the text. */
export interface AxHandle {
  frame: string;
  backendNodeId: number;
}

export interface AxRendering {
  snapshot: string;
  refs: A11yRefMap;
  handles: Record<string, AxHandle>;
  frames: number;
  unreadableFrames: string[];
}

const CONTROLS = [
  "link",
  "button",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "switch",
  "slider",
  "spinbutton",
  "treeitem",
];

const STRUCTURE = [
  "heading",
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "search",
  "dialog",
  "alertdialog",
  "tablist",
  "tabpanel",
  "menu",
  "menubar",
  "toolbar",
  "tree",
  "grid",
];

/** `form` and `region` are landmarks only when they carry a name (WAI-ARIA 1.2). */
const NAMED_LANDMARKS = ["form", "region"];

/** The roles a rendering keeps; everything else is collapsed into its nearest kept ancestor. */
export const AX_KEPT_ROLES: readonly string[] = [...CONTROLS, ...STRUCTURE, ...NAMED_LANDMARKS];

function normalizeName(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function keeps(role: string, name: string): boolean {
  if (NAMED_LANDMARKS.includes(role)) {
    return name.length > 0;
  }
  if (role === "image" || role === "img") {
    return name.length > 0;
  }
  return CONTROLS.includes(role) || STRUCTURE.includes(role);
}

function quote(name: string): string {
  return name ? ` "${name.replace(/"/g, '\\"')}"` : "";
}

/**
 * Render the page and its frames in order: the page's tree first, then each out-of-process frame
 * as a `frame "<url>"` heading with its own kept nodes indented below it.
 */
export function renderAxForest(forest: readonly AxFrameTree[]): AxRendering {
  const lines: string[] = [];
  const refs: A11yRefMap = {};
  const handles: Record<string, AxHandle> = {};
  const unreadableFrames: string[] = [];
  let next = 1;

  for (const tree of forest) {
    const isMain = tree.frame === "main";
    const base = isMain ? 0 : 1;
    if (!isMain) {
      lines.push(`frame${quote(tree.url)}`);
    }
    if (tree.error !== undefined) {
      unreadableFrames.push(tree.url);
      lines.push(`  (unreadable: ${tree.error})`);
      continue;
    }
    const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
    const root = tree.nodes.find((node) => !node.parentId) ?? tree.nodes[0];
    if (!root) {
      continue;
    }
    const walk = (node: AxRawNode, depth: number): void => {
      const role = node.role?.value ?? "";
      const name = normalizeName(node.name?.value);
      const kept = !node.ignored && keeps(role, name);
      if (kept) {
        const ref = `e${next++}`;
        refs[ref] = { role, name };
        if (node.backendDOMNodeId !== undefined) {
          handles[ref] = { frame: tree.frame, backendNodeId: node.backendDOMNodeId };
        }
        lines.push(`${"  ".repeat(depth + base)}${role}${quote(name)} [${ref}]`);
      }
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) {
          walk(child, kept ? depth + 1 : depth);
        }
      }
    };
    walk(root, 0);
  }

  return {
    snapshot: lines.join("\n"),
    refs,
    handles,
    frames: forest.filter((tree) => tree.frame !== "main").length,
    unreadableFrames,
  };
}
