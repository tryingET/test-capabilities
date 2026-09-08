import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The pure frame classifier (frame-root-cause packet, `## Refinement`).
 *
 * Every case runs against the captured corpus under `tests/fixtures/captures/frame-diagnose/`:
 * three documents captured live against Chromium (Agent) on 2026-09-08 (owned tabs, no login)
 * and five synthetic ones whose shapes are derived from those captures. The corpus is the
 * specification; the classifier is never asserted against remembered prose.
 */

const {
  classifyFrameTopology,
  determineFrameRootCause,
  FRAME_DETERMINATION_VALUES,
  FRAME_TOPOLOGY_TAGS,
  frameDeterminationFromEvidence,
  frameSwitchSuggestion,
  isHiddenFrame,
  parseFrameHint,
  parseFrameRootCauseMarker,
  parseSurfFrameDiagnosis,
  renderFrameRootCauseEvidence,
  renderFrameRootCauseMarker,
} = await importRuntimeModule("core/frame-root-cause.js");
const { OUTCOME_BASES } = await importRuntimeModule("core/result-classification.js");

const capturesDir = new URL("./fixtures/captures/frame-diagnose/", import.meta.url).pathname;

function loadCapture(name) {
  return JSON.parse(readFileSync(path.join(capturesDir, `${name}.json`), "utf8"));
}

function topologyOf(name) {
  return classifyFrameTopology(parseSurfFrameDiagnosis(loadCapture(name).stdout));
}

function diagnose(name, options = {}) {
  return determineFrameRootCause({
    selector: options.selector ?? "#does-not-exist",
    topology: topologyOf(name),
    ...(options.hint ? { hint: parseFrameHint(options.hint) } : {}),
    ...(options.failure ? { failure: options.failure } : {}),
    source: { command: "frame.diagnose", tabId: 1, ...(options.source ?? {}) },
  });
}

// ---- the corpus ------------------------------------------------------------

test("the frame-diagnose corpus is well formed and records its provenance", () => {
  const files = readdirSync(capturesDir).filter((entry) => entry.endsWith(".json"));
  assert.equal(files.length >= 8, true, "the frame-diagnose corpus lost captures");

  for (const file of files) {
    const capture = JSON.parse(readFileSync(path.join(capturesDir, file), "utf8"));
    assert.equal(capture.capture_version, 1, file);
    assert.equal(capture.tool.name, "surf", file);
    assert.match(capture.tool.version, /^\d+\.\d+\.\d+$/, file);
    assert.equal(["live", "synthetic"].includes(capture.source), true, file);
    assert.equal(typeof capture.note, "string", file);
    assert.deepEqual(capture.command.slice(0, 1), ["frame.diagnose"], file);
    // A synthetic capture must say which live shape it was derived from.
    if (capture.source === "synthetic") {
      assert.equal(typeof capture.derived_from, "string", file);
    } else {
      assert.match(capture.tool.browser, /Chromium \(Agent\)/, file);
      assert.equal(typeof capture.url, "string", file);
    }
    // The payload is the real envelope: result + target + notice.
    assert.equal(typeof capture.stdout.result.mainPage.href, "string", file);
    assert.equal(typeof capture.stdout.target.browserEpoch, "string", file);
  }
});

test("a payload that is not a frame inventory refuses instead of reading as an empty page", () => {
  for (const payload of [undefined, null, {}, { result: {} }, { result: { mainPage: {} } }]) {
    assert.throws(
      () => parseSurfFrameDiagnosis(payload),
      (error) => error.code === "frame_diagnosis_failed",
      `parsed ${JSON.stringify(payload)} instead of refusing`,
    );
  }
});

// ---- layer 1: topology tags ------------------------------------------------

test("one tag per rule, from structural fields only", () => {
  const mdn = topologyOf("mdn-iframe");
  // three shadow-hosted, cross-origin iframes that are missing from the CDP tree
  const oop = mdn.candidates.filter((candidate) => candidate.domIndex !== null);
  assert.equal(oop.length, 3);
  for (const candidate of oop) {
    assert.deepEqual([...candidate.tags].sort(), ["out_of_process_frame", "shadow_hosted_frame"]);
    assert.equal(candidate.primaryTag, "out_of_process_frame");
    assert.equal(candidate.outOfProcess, true);
    assert.equal(candidate.contentScriptReachable, true);
  }

  // a cross-origin frame that IS in the CDP tree is cross_origin_frame, not out_of_process
  const inProcess = topologyOf("in-process-cross-origin").candidates;
  assert.equal(inProcess.length, 1);
  assert.deepEqual(inProcess[0].tags, ["cross_origin_frame"]);
  assert.equal(inProcess[0].outOfProcess, false);

  // a frame below another frame has no <iframe> of its own in the top document
  const nested = topologyOf("nested-srcdoc").candidates.find(
    (candidate) => candidate.domIndex === null,
  );
  assert.equal(nested.tags.includes("nested_frame"), true);
  assert.equal(nested.frameId, 42);

  // every tag the module publishes is one this corpus can produce or exclude
  const seen = new Set(
    [
      ...topologyOf("mdn-iframe").candidates,
      ...topologyOf("in-process-cross-origin").candidates,
      ...topologyOf("nested-srcdoc").candidates,
      ...topologyOf("hidden-0x0").excludedHidden,
    ].flatMap((candidate) => candidate.tags),
  );
  assert.deepEqual(
    [...FRAME_TOPOLOGY_TAGS].filter((tag) => !seen.has(tag)),
    [],
  );
});

test("primary tag precedence: out_of_process over cross_origin over shadow over nested", () => {
  const mdn = topologyOf("mdn-iframe");
  const shadowHostedOop = mdn.candidates.find(
    (candidate) =>
      candidate.tags.includes("out_of_process_frame") &&
      candidate.tags.includes("shadow_hosted_frame"),
  );
  assert.equal(shadowHostedOop.primaryTag, "out_of_process_frame");

  const nestedCrossOrigin = mdn.candidates.find(
    (candidate) =>
      candidate.tags.includes("nested_frame") && candidate.tags.includes("cross_origin_frame"),
  );
  assert.equal(nestedCrossOrigin.primaryTag, "cross_origin_frame");
});

test("the hidden rule is the framework's own: 1x1 is hidden although surf says zeroSize false", () => {
  // the live claude.ai/login pixel: rect 1x1, blank, and surf's own zeroSize is false
  const pixel = loadCapture("claude-login").stdout.result.domIframes.find(
    (frame) => frame.rect.width === 1 && frame.rect.height === 1,
  );
  assert.equal(pixel.zeroSize, false, "the capture no longer carries the 1x1 pixel");
  assert.equal(isHiddenFrame(pixel), true);

  assert.equal(isHiddenFrame({ zeroSize: true, rect: { width: 300, height: 150 } }), true);
  assert.equal(isHiddenFrame({ rect: { width: 0, height: 400 }, blank: true, src: "" }), true);
  // a blank, src-less frame that is nevertheless laid out at a real box is a candidate: an
  // exclusion is the strongest claim this module makes (measured live: w3schools try-it renders
  // a 933x949 result frame with blank: true, src: "")
  assert.equal(isHiddenFrame({ rect: { width: 933, height: 949 }, blank: true, src: "" }), false);
  assert.equal(isHiddenFrame({ rect: { width: 600, height: 400 } }), false);
});

test("hidden frames leave the candidate set and stay as evidence", () => {
  const hidden = topologyOf("hidden-0x0");
  assert.equal(hidden.candidates.length, 0);
  assert.equal(hidden.excludedHidden.length, 1);
  assert.equal(hidden.excludedHidden[0].tags.includes("hidden_frame"), true);

  const login = topologyOf("claude-login");
  assert.equal(login.excludedHidden.length, 3, "two 0x0 frames and the 1x1 pixel");
  assert.equal(login.candidates.length, 2, "the two off-screen 300x150 challenge frames");
});

test("surf's warnings travel verbatim and never reach a rule", () => {
  const mdn = topologyOf("mdn-iframe");
  const captured = loadCapture("mdn-iframe").stdout.result.warnings;
  assert.deepEqual(mdn.warnings, captured.slice(0, 10));
  assert.equal(
    mdn.warnings.some((warning) => warning.includes("is out-of-process")),
    true,
  );

  // strip every warning: the tags and the determination are unchanged, because they are
  // computed from fields (packet Clash 4 - the warning-text fallback is dropped)
  const stripped = loadCapture("mdn-iframe");
  stripped.stdout.result.warnings = [];
  const withoutProse = classifyFrameTopology(parseSurfFrameDiagnosis(stripped.stdout));
  assert.deepEqual(
    withoutProse.candidates.map((candidate) => candidate.primaryTag),
    mdn.candidates.map((candidate) => candidate.primaryTag),
  );
  assert.deepEqual(withoutProse.inconsistencies, mdn.inconsistencies);
});

test("evidence is capped so one page cannot bloat a finding", () => {
  const mdn = topologyOf("mdn-iframe");
  for (const candidate of mdn.candidates) {
    assert.equal(candidate.src.length <= 161, true, candidate.src);
  }
  assert.equal(mdn.candidates.length <= 10, true);
  assert.equal(mdn.warnings.length <= 10, true);
});

// ---- layer 2: one case per determination -----------------------------------

test("excluded: no candidate frame after the hidden rule", () => {
  for (const name of ["example-com", "hidden-0x0"]) {
    const rootCause = diagnose(name);
    assert.equal(rootCause.determination.value, "excluded", name);
    assert.equal(rootCause.determination.basis, "evidence", name);
    assert.deepEqual(rootCause.determination.candidates, ["excluded"], name);
    assert.equal(rootCause.code, undefined, name);
    assert.equal(rootCause.primaryTag, null, name);
  }
});

test("suspected: candidates exist and nothing links the selector to any of them", () => {
  const mdn = diagnose("mdn-iframe");
  assert.equal(mdn.determination.value, "suspected");
  assert.equal(mdn.determination.basis, "no_evidence");
  assert.deepEqual(mdn.determination.candidates, ["suspected", "confirmed", "excluded"]);
  assert.equal(mdn.primaryTag, null, "a suspicion names no frame");
  assert.equal(mdn.confirmedCandidate, null);
  assert.match(mdn.determination.reason, /--frame-hint/);
});

test("confirmed: a hint that resolves to exactly one reachable candidate", () => {
  const mdn = topologyOf("mdn-iframe");
  const host = new URL(mdn.candidates[0].src).origin;
  const rootCause = diagnose("mdn-iframe", { hint: `urlPrefix=${host}` });

  assert.equal(rootCause.determination.value, "confirmed");
  assert.equal(rootCause.determination.basis, "evidence");
  assert.equal(rootCause.primaryTag, "out_of_process_frame");
  assert.equal(rootCause.confirmedCandidate.domIndex, 0);
  assert.equal(rootCause.hint, `urlPrefix=${host}`);

  const suggestion = frameSwitchSuggestion(rootCause);
  assert.deepEqual(suggestion, { kind: "frame.switch", index: 0, urlPrefix: host, hops: 1 });
});

test("confirmed by a selector hint on the frame's own id, and two hops for a nested frame", () => {
  const byId = diagnose("in-process-cross-origin", { hint: "selector=iframe#pay" });
  assert.equal(byId.determination.value, "confirmed");
  assert.equal(byId.primaryTag, "cross_origin_frame");

  const nested = diagnose("nested-srcdoc", { hint: "urlPrefix=about:srcdoc" });
  assert.equal(nested.determination.value, "confirmed");
  assert.equal(frameSwitchSuggestion(nested).hops, 2);
  assert.equal(frameSwitchSuggestion(nested).frameId, 42);
});

test("a hint that resolves to zero or several candidates is undetermined, never suspected", () => {
  const none = diagnose("mdn-iframe", { hint: "urlPrefix=https://nowhere.example/" });
  assert.equal(none.determination.value, "undetermined");
  assert.equal(none.determination.basis, "contradiction");
  assert.equal(none.code, "frame_diagnosis_undetermined");
  assert.match(none.determination.reason, /matched none/);

  const several = diagnose("mdn-iframe", { hint: "urlPrefix=https://" });
  assert.equal(several.determination.value, "undetermined");
  assert.match(several.determination.reason, /matched 4 candidate frames/);

  // a selector shape the module cannot evaluate matches nothing rather than guessing
  const unevaluable = diagnose("in-process-cross-origin", { hint: "selector=div > iframe:nth(2)" });
  assert.equal(unevaluable.determination.value, "undetermined");
});

test("a hint on a candidate whose content script does not answer is undetermined", () => {
  const rootCause = diagnose("unreachable-content-script", {
    hint: "urlPrefix=https://pay.example.net/",
  });
  assert.equal(rootCause.determination.value, "undetermined");
  assert.match(rootCause.determination.reason, /content script does not answer/);
  assert.equal(frameSwitchSuggestion(rootCause), undefined);
});

test("an inventory that disagrees with itself is undetermined, with or without a hint", () => {
  const closedShadow = diagnose("closed-shadow-mismatch");
  assert.equal(closedShadow.determination.value, "undetermined");
  assert.match(closedShadow.determination.reason, /closed shadow root/);

  const counted = loadCapture("example-com");
  counted.stdout.result.counts.domIframes = 4;
  const rootCause = determineFrameRootCause({
    selector: "#x",
    topology: classifyFrameTopology(parseSurfFrameDiagnosis(counted.stdout)),
    source: { command: "frame.diagnose" },
  });
  assert.equal(rootCause.determination.value, "undetermined");
  assert.match(rootCause.determination.reason, /counted 4 DOM iframe\(s\) and listed 0/);
});

test("unmatched url-less CDP child frames block a hint, but not an unhinted determination", () => {
  const login = topologyOf("claude-login");
  assert.equal(login.unmatchedCdpFrames, 1);

  assert.equal(diagnose("claude-login").determination.value, "suspected");
  const hinted = diagnose("claude-login", { hint: "urlPrefix=https://newassets.hcaptcha.com/" });
  assert.equal(hinted.determination.value, "undetermined");
  assert.match(hinted.determination.reason, /CDP child frame\(s\)/);
});

test("navigation between the failure and the diagnosis is undetermined with both hrefs", () => {
  const moved = diagnose("example-com", { failure: { href: "https://example.com/checkout" } });
  assert.equal(moved.determination.value, "undetermined");
  assert.match(moved.determination.reason, /https:\/\/example\.com\/checkout/);
  assert.match(moved.determination.reason, /https:\/\/example\.com\//);

  // the same href with a different fragment is the same page
  const sameUrl = diagnose("example-com", { failure: { href: "https://example.com/#top" } });
  assert.equal(sameUrl.determination.value, "excluded");

  const newEpoch = diagnose("example-com", {
    failure: { browserEpoch: "epoch-a" },
    source: { browserEpoch: "epoch-b" },
  });
  assert.equal(newEpoch.determination.value, "undetermined");
  assert.match(newEpoch.determination.reason, /browser epoch changed/);
});

test("unavailable when no diagnosis exists; it is never defaulted to excluded", () => {
  const rootCause = determineFrameRootCause({
    selector: "#x",
    source: { command: "frame.diagnose" },
    unavailableReason: "surf exited 9",
  });
  assert.equal(rootCause.determination.value, "unavailable");
  assert.equal(rootCause.determination.basis, "no_evidence");
  assert.equal(rootCause.code, "frame_diagnosis_failed");
  assert.deepEqual(rootCause.candidates, []);
  assert.equal(rootCause.counts, null);
  assert.equal(rootCause.determination.reason, "surf exited 9");
});

test("candidate disagreement without a hint stays suspected", () => {
  // MDN carries three primary tags on one page (out-of-process, cross-origin, nested); the
  // packet's own risk case: a typo in a main-document selector produces this same inventory
  const mdn = diagnose("mdn-iframe");
  const tags = new Set(mdn.candidates.map((candidate) => candidate.primaryTag));
  assert.equal(tags.size >= 3, true, [...tags].join(","));
  assert.equal(mdn.determination.value, "suspected");
});

test("every determination fills the kernel determination shape", () => {
  const seen = new Set();
  const cases = [
    diagnose("example-com"),
    diagnose("mdn-iframe"),
    diagnose("mdn-iframe", { hint: `urlPrefix=${topologyOf("mdn-iframe").candidates[0].src}` }),
    diagnose("closed-shadow-mismatch"),
    determineFrameRootCause({ selector: "#x", source: { command: "frame.diagnose" } }),
  ];
  for (const rootCause of cases) {
    const { value, basis, candidates, reason } = rootCause.determination;
    assert.equal(FRAME_DETERMINATION_VALUES.includes(value), true, value);
    assert.equal(OUTCOME_BASES.includes(basis), true, basis);
    assert.equal(candidates.includes(value), true, value);
    assert.equal(reason.length > 20, true, reason);
    seen.add(value);
  }
  assert.deepEqual(
    [...FRAME_DETERMINATION_VALUES].filter((value) => !seen.has(value)),
    [],
  );
});

// ---- the marker rendering --------------------------------------------------

test("the marker round-trips the typed field and is the only line a legacy reader parses", () => {
  const host = new URL(topologyOf("mdn-iframe").candidates[0].src).origin;
  for (const rootCause of [
    diagnose("example-com"),
    diagnose("mdn-iframe"),
    diagnose("mdn-iframe", { hint: `urlPrefix=${host}` }),
    diagnose("closed-shadow-mismatch"),
  ]) {
    const marker = renderFrameRootCauseMarker(rootCause);
    const parsed = parseFrameRootCauseMarker(marker);
    assert.equal(parsed.determination, rootCause.determination.value, marker);
    assert.equal(parsed.primaryTag, rootCause.primaryTag, marker);
    assert.equal(parsed.candidates, rootCause.candidates.length, marker);
    assert.equal(parsed.hint, rootCause.hint, marker);

    const evidence = renderFrameRootCauseEvidence(rootCause);
    assert.equal(evidence[0], marker, "the marker is the first evidence line");
    assert.equal(
      evidence.every((line) => line.startsWith("frame-root-cause:")),
      true,
    );
    assert.equal(frameDeterminationFromEvidence(evidence), rootCause.determination.value);
  }

  assert.equal(parseFrameRootCauseMarker("frame-root-cause: determination=nonsense"), undefined);
  assert.equal(parseFrameRootCauseMarker("not a marker"), undefined);
  assert.equal(frameDeterminationFromEvidence(["css selector matched zero elements"]), undefined);
  assert.equal(frameDeterminationFromEvidence(undefined), undefined);
});

test("--frame-hint is read strictly; a shape the framework cannot read is refused", () => {
  assert.deepEqual(parseFrameHint("urlPrefix=https://a.example/"), {
    kind: "urlPrefix",
    value: "https://a.example/",
    raw: "urlPrefix=https://a.example/",
  });
  assert.equal(parseFrameHint("selector=iframe#player").kind, "selector");

  for (const raw of ["https://a.example/", "url=https://a.example/", "urlPrefix=", "selector="]) {
    assert.throws(
      () => parseFrameHint(raw),
      (error) => error.code === "config_invalid",
      raw,
    );
  }
});
