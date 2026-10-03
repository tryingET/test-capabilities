import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { startFakeCdp } from "./fake-cdp.mjs";
import { createFakeSurf, withFakeSurfEnv } from "./fake-surf.mjs";

/**
 * The fakes a `surf flow` test runs against (AK #6164): a fake surf that opens, gates and closes
 * the tab, and a fake DevTools endpoint holding the same page, whose elements the acts reach and
 * whose form model the reads evaluate against.
 */

export const PAGE = "https://shop.example/flow";
export const DONE = "https://shop.example/done";
export const EVIL = "https://evil.example/x";
/**
 * The card number the flows type, found where it leaked: never as part of a longer hex run, since
 * every receipt carries random UUIDs and digests that contain "4242" by chance now and then.
 */
export const LEAKED_CARD = /(?<![0-9a-f])4242(?![0-9a-f])/;

export const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

/** What the reads see: the form model, laid over by what the acts set. */
export const MODEL = {
  title: "Flow",
  bodyText: "Welcome to the shop",
  fields: {
    "#user": { value: "", name: "user", form: "#login" },
    "#card": { value: "", name: "card", form: "#pay-form" },
    "#country": { kind: "select", value: "de", name: "country", form: "#pay-form" },
    "#terms": { kind: "checkbox", name: "terms", form: "#pay-form" },
  },
  controls: [
    { selector: "#pay", kind: "submit", text: "Pay", form: "#pay-form" },
    { selector: "#help", kind: "button", text: "Help" },
  ],
};

export function cdpTree(url) {
  return {
    url,
    nodes: [ax("1", "RootWebArea", "Flow", 0, ["2"]), ax("2", "textbox", "User", 31)],
    elements: {
      "#user": { backendNodeId: 31, box: [10, 10, 200, 20] },
      "#card": { backendNodeId: 32, box: [10, 40, 200, 20], gatedKeys: ["Enter"] },
      "#country": {
        backendNodeId: 33,
        box: [10, 70, 100, 20],
        options: [
          { value: "de", label: "Germany" },
          { value: "fr", label: "France" },
        ],
      },
      "#terms": { backendNodeId: 34, box: [10, 100, 20, 20], type: "checkbox", checked: false },
      "#pay": { backendNodeId: 35, box: [10, 130, 60, 20], gated: true, gatedKeys: ["Enter", " "] },
      "#help": { backendNodeId: 36, box: [100, 130, 60, 20] },
      "a.away": { backendNodeId: 37, box: [200, 130, 60, 20], navigatesTo: EVIL },
    },
    form: structuredClone(MODEL),
  };
}

export function writeConfig(dir, origins = ["https://shop.example"]) {
  const file = path.join(dir, "tc.yaml");
  writeFileSync(
    file,
    [
      "receipts:",
      `  dir: ${path.join(dir, "receipts")}`,
      "  ephemeral: true",
      "mutation:",
      "  allow_origins:",
      ...origins.map((origin) => `    - "${origin}"`),
      "surf:",
      "  submit:",
      "    postcondition_timeout_ms: 600",
      "",
    ].join("\n"),
  );
  return file;
}

export function receiptsIn(dir) {
  const root = path.join(dir, "receipts");
  let runs;
  try {
    runs = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return runs
    .filter((entry) => entry.isDirectory())
    .flatMap((run) =>
      readdirSync(path.join(root, run.name))
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => JSON.parse(readFileSync(path.join(root, run.name, entry), "utf-8"))),
    )
    .filter((artifact) => artifact.artifact_kind === "test-capabilities.mutation.receipt");
}

export const flowOf = (steps, url = PAGE) => ({ schema_version: 1, url, steps });

/** Run `body` with both fakes up and the endpoint pointed at the DevTools fake (or at nothing). */
export async function withFlowFakes(
  body,
  { cdp: withCdp = true, origins, tree: makeTree = cdpTree } = {},
) {
  const surf = createFakeSurf({
    pages: {
      [PAGE]: { ...structuredClone(MODEL), readiness: "ready", links: [] },
      [DONE]: { title: "Done", readiness: "ready", links: [] },
    },
  });
  const tree = makeTree(PAGE);
  const cdp = withCdp ? await startFakeCdp({ pages: { P1: { url: PAGE, tree } } }) : undefined;
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-flow-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp ? cdp.url : "http://127.0.0.1:1";
  const config = writeConfig(dir, origins);
  const write = (flow, name = "flow.json") => {
    const file = path.join(dir, name);
    writeFileSync(file, flow instanceof Object ? JSON.stringify(flow) : flow);
    return file;
  };
  try {
    await withFakeSurfEnv(surf.path, async () => {
      await body({ surf, cdp, tree, dir, config, write });
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    await cdp?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
