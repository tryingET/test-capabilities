import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const {
  ARTIFACT_FILE_MODE,
  FileReceiptStore,
  listJsonArtifacts,
  writeJsonArtifactSync,
  writeJsonArtifact,
} = await importRuntimeModule("core/artifacts.js");
const { coerceReceipt, isInDoubt, matchesReceiptFilter, MUTATION_RECEIPT_KIND, redactReceipt } =
  await importRuntimeModule("core/receipt-store.js");

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "tc-receipts-"));
}

function receipt(overrides = {}) {
  return {
    schema_version: 1,
    artifact_kind: MUTATION_RECEIPT_KIND,
    receipt_id: "r1",
    run_id: "run-1",
    operation_id: "heal",
    step_id: "heal.apply:/abs/tests/login.spec.ts",
    effect: "mutating",
    scope: "workspace",
    subject: "/abs/tests/login.spec.ts",
    intent: "replace 2 selector(s)",
    idempotency_key: "sha256:aa",
    attempt: 1,
    started_at: "2026-09-08T00:00:00.000Z",
    outcome: "attempting",
    evidence: [],
    ...overrides,
  };
}

test("the artifact writer fsyncs the file and its directory before it returns", () => {
  const dir = scratch();
  const target = path.join(dir, "nested", "artifact.json");
  const realFsync = fs.fsyncSync;
  const synced = [];
  fs.fsyncSync = (descriptor) => {
    synced.push(descriptor);
    return realFsync(descriptor);
  };
  try {
    writeJsonArtifactSync(target, { a: 1 }, { label: "Artifact output" });
  } finally {
    fs.fsyncSync = realFsync;
  }

  // one for the file, one for the directory the rename happened in: without the second the
  // renamed file can exist with no name after a power loss (mutation-safety packet, School 2).
  assert.equal(synced.length, 2, "expected fsync on both the file and its directory");
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { a: 1 });
  assert.equal(statSync(target).mode & 0o777, ARTIFACT_FILE_MODE);
  assert.deepEqual(
    fs.readdirSync(path.dirname(target)),
    ["artifact.json"],
    "no temp file may survive a successful write",
  );
});

test("the artifact writer refuses every symlinked path component and output", () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "real"));
  symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
  assert.throws(
    () => writeJsonArtifactSync(path.join(dir, "link", "a.json"), {}, { label: "Receipt" }),
    /Receipt directory component must not be a symlink/,
  );

  writeFileSync(path.join(dir, "target.json"), "{}");
  symlinkSync(path.join(dir, "target.json"), path.join(dir, "alias.json"));
  assert.throws(
    () => writeJsonArtifactSync(path.join(dir, "alias.json"), {}, { label: "Receipt" }),
    /Receipt must not be a symlink/,
  );

  fs.mkdirSync(path.join(dir, "adir.json"));
  assert.throws(
    () => writeJsonArtifactSync(path.join(dir, "adir.json"), {}, { label: "Receipt" }),
    /Receipt path is not a regular file/,
  );

  writeFileSync(path.join(dir, "notadir"), "x");
  assert.throws(
    () => writeJsonArtifactSync(path.join(dir, "notadir", "a.json"), {}, { label: "Receipt" }),
    /Receipt directory component is not a directory/,
  );
});

test("the artifact writer replaces an existing artifact atomically and leaves no temp file", async () => {
  const dir = scratch();
  const target = path.join(dir, "a.json");
  await writeJsonArtifact(target, { v: 1 });
  await writeJsonArtifact(target, { v: 2 });
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { v: 2 });
  assert.deepEqual(fs.readdirSync(dir), ["a.json"]);
});

test("listing reads one nested level, filters by kind and never follows a symlink", () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "run-1"));
  fs.mkdirSync(path.join(dir, "run-1", "deeper"));
  writeFileSync(path.join(dir, "run-1", "a.json"), JSON.stringify(receipt()));
  writeFileSync(
    path.join(dir, "run-1", "b.json"),
    JSON.stringify({ artifact_kind: "test-capabilities.heal.proposal" }),
  );
  writeFileSync(path.join(dir, "run-1", "c.json"), "not json at all");
  writeFileSync(path.join(dir, "run-1", "d.txt"), "{}");
  writeFileSync(path.join(dir, "run-1", "deeper", "e.json"), JSON.stringify(receipt()));
  symlinkSync(path.join(dir, "run-1", "a.json"), path.join(dir, "run-1", "link.json"));

  const all = listJsonArtifacts(dir);
  assert.deepEqual(
    all.map((entry) => path.basename(entry.path)),
    ["a.json", "b.json"],
    "one nested level, no symlinks, no unparsable files, no non-json names",
  );
  assert.deepEqual(
    listJsonArtifacts(dir, MUTATION_RECEIPT_KIND).map((entry) => path.basename(entry.path)),
    ["a.json"],
  );
  assert.deepEqual(listJsonArtifacts(path.join(dir, "missing")), []);
});

test("the file store writes one receipt per run directory, owner-only", async () => {
  const dir = scratch();
  const store = new FileReceiptStore(path.join(dir, "receipts"));
  await store.append(receipt());
  const file = path.join(dir, "receipts", "run-1", "r1.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).outcome, "attempting");

  await store.append(receipt({ outcome: "applied", finished_at: "2026-09-08T00:00:01.000Z" }));
  assert.equal(JSON.parse(readFileSync(file, "utf8")).outcome, "applied");
  assert.deepEqual(fs.readdirSync(path.join(dir, "receipts", "run-1")), ["r1.json"]);
});

test("a receipt store that cannot be written refuses with mutation_receipt_write_failed", async () => {
  const dir = scratch();
  writeFileSync(path.join(dir, "receipts"), "not a directory");
  const store = new FileReceiptStore(path.join(dir, "receipts"));
  await assert.rejects(store.append(receipt()), (error) => {
    assert.equal(error.code, "mutation_receipt_write_failed");
    assert.match(error.message, /The step was not run/);
    assert.match(error.message, /TEST_CAPABILITIES_RECEIPTS_DIR/);
    return true;
  });
});

test("the store filters by key, plan, mode and doubt", async () => {
  const dir = scratch();
  const store = new FileReceiptStore(dir);
  await store.append(receipt({ receipt_id: "r1", idempotency_key: "sha256:aa" }));
  await store.append(
    receipt({
      receipt_id: "r2",
      run_id: "run-2",
      idempotency_key: "sha256:bb",
      outcome: "applied",
      details: { plan_id: "plan-1", mode: "submit" },
    }),
  );

  assert.deepEqual(
    (await store.list({ idempotencyKey: "sha256:aa" })).map((entry) => entry.receipt_id),
    ["r1"],
  );
  assert.deepEqual(
    (await store.list({ planId: "plan-1", mode: "submit" })).map((entry) => entry.receipt_id),
    ["r2"],
  );
  assert.deepEqual(
    (await store.list({ planId: "plan-1", mode: "fill" })).map((entry) => entry.receipt_id),
    [],
  );
  assert.deepEqual(
    (await store.list({ inDoubt: true })).map((entry) => entry.receipt_id),
    ["r1"],
    "applied is a definite outcome and is not in doubt",
  );
  assert.equal((await store.list()).length, 2);
});

test("a damaged receipt file blocks its key instead of unlocking it", async () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "run-9"), { recursive: true });
  writeFileSync(
    path.join(dir, "run-9", "broken.json"),
    JSON.stringify({ artifact_kind: MUTATION_RECEIPT_KIND, idempotency_key: "sha256:cc" }),
  );
  const store = new FileReceiptStore(dir);
  const [read] = await store.list({ idempotencyKey: "sha256:cc" });
  assert.equal(read.outcome, "unknown");
  assert.equal(read.receipt_id, "broken");
  assert.equal(isInDoubt(read), true);

  assert.equal(coerceReceipt({ artifact_kind: "something.else" }, "x"), undefined);
});

test("the envelope copy carries hashes, codes and counts, never free text", () => {
  const copy = redactReceipt(
    receipt({
      outcome: "failed",
      evidence: [`before sha256:${"a".repeat(64)}`, "surf said: the page moved to /login?u=me"],
      error: { code: "page_login", message: "credentials for user@example.com required" },
      details: {
        plan_id: "plan-1",
        mode: "submit",
        attempts: 2,
        confirmed: true,
        secret: "hunter2 with spaces",
        fields: [{ id: "q" }, { id: "r" }],
        submit: { text: "Send" },
        nothing: null,
      },
    }),
    "/abs/receipts/run-1/r1.json",
  );

  assert.deepEqual(copy.evidence, [`before sha256:${"a".repeat(64)}`]);
  assert.equal(copy.evidence_redacted, 1);
  assert.deepEqual(copy.error, { code: "page_login" });
  assert.equal(copy.details.plan_id, "plan-1");
  assert.equal(copy.details.mode, "submit");
  assert.equal(copy.details.attempts, 2);
  assert.equal(copy.details.confirmed, true);
  assert.deepEqual(copy.details.secret, { redacted: true, bytes: 19 });
  assert.deepEqual(copy.details.fields, { redacted: true, count: 2 });
  assert.deepEqual(copy.details.submit, { redacted: true, keys: 1 });
  assert.equal(copy.details.nothing, null);
  assert.equal(copy.path, "/abs/receipts/run-1/r1.json");
  assert.equal(copy.subject, "/abs/tests/login.spec.ts");
});

test("the filter helper answers without a store", () => {
  const stored = receipt({ details: { plan_id: "p", mode: "fill" } });
  assert.equal(matchesReceiptFilter(stored), true);
  assert.equal(matchesReceiptFilter(stored, {}), true);
  assert.equal(matchesReceiptFilter(stored, { outcome: "applied" }), false);
  assert.equal(matchesReceiptFilter(stored, { planId: "p" }), true);
  assert.equal(matchesReceiptFilter(receipt(), { planId: "p" }), false);
  assert.equal(matchesReceiptFilter(stored, { inDoubt: true }), true);
});

const {
  createRunContext,
  DEFAULT_RECEIPTS_DIR,
  detectEphemeralStore,
  RECEIPTS_DIR_ENV,
  RECEIPTS_EPHEMERAL_ENV,
  readConfigReceiptsSection,
  receiptsBaseFor,
  resolveReceiptsSettings,
} = await importRuntimeModule("core/run-context.js");

const READ_ONLY = { effect: "read_only", reason: "reads only" };

test("where receipts live is defined per operation, because most operations have no config", () => {
  const cwd = "/work/project";
  assert.deepEqual(receiptsBaseFor("test", { config: "conf/tc.yaml" }, cwd), {
    base: "/work/project/conf",
    source: "the directory of --config conf/tc.yaml",
  });
  assert.equal(receiptsBaseFor("heal", { dir: "./tests" }, cwd).base, "/work/project/tests");
  assert.equal(receiptsBaseFor("init", {}, cwd).base, cwd);
  assert.equal(receiptsBaseFor("replacement-validation", undefined, cwd).base, cwd);
  assert.equal(receiptsBaseFor("test", {}, cwd).base, cwd, "no --config falls back to the cwd");
});

test("the receipts directory resolves env over config over the default", () => {
  const cwd = "/work/project";
  const base = { operationId: "heal", effect: READ_ONLY, input: { dir: "tests" }, cwd, env: {} };

  const fallback = resolveReceiptsSettings(base);
  assert.equal(fallback.dir, path.join("/work/project/tests", DEFAULT_RECEIPTS_DIR));
  assert.match(fallback.source, /^the default, under --dir tests$/);
  assert.equal(fallback.ephemeral, false);

  const declared = resolveReceiptsSettings({
    ...base,
    config: { receipts: { dir: "../receipts", ephemeral: true } },
  });
  assert.equal(declared.dir, "/work/project/receipts");
  assert.match(declared.source, /^receipts\.dir, resolved against --dir tests$/);
  assert.equal(declared.ephemeral, true);

  const fromEnv = resolveReceiptsSettings({
    ...base,
    env: { [RECEIPTS_DIR_ENV]: "elsewhere", [RECEIPTS_EPHEMERAL_ENV]: "1" },
    config: { receipts: { dir: "../receipts", ephemeral: false } },
  });
  assert.equal(fromEnv.dir, "/work/project/elsewhere");
  assert.equal(fromEnv.source, RECEIPTS_DIR_ENV);
  assert.equal(fromEnv.ephemeral, true);

  for (const off of ["", "0", "false", undefined]) {
    assert.equal(
      resolveReceiptsSettings({ ...base, env: { [RECEIPTS_EPHEMERAL_ENV]: off } }).ephemeral,
      false,
    );
  }
});

test("a store that does not survive the run is detected and named", () => {
  const tmpRoot = fs.realpathSync(os.tmpdir());
  assert.match(
    detectEphemeralStore(path.join(tmpRoot, "job", "receipts"), {}),
    /inside the temporary directory/,
  );
  assert.equal(detectEphemeralStore("/durable/receipts", { TMPDIR: tmpRoot }), undefined);
  assert.match(
    detectEphemeralStore("/gha/work/repo/receipts", {
      CI: "true",
      GITHUB_WORKSPACE: "/gha/work/repo",
    }),
    /inside the CI job workspace/,
  );
  assert.equal(
    detectEphemeralStore("/elsewhere/receipts", { CI: "true", GITHUB_WORKSPACE: "/gha/work/repo" }),
    undefined,
  );
  assert.match(detectEphemeralStore("/anywhere", { CI: "1" }), /CI is set/);
  assert.equal(detectEphemeralStore("/anywhere", { CI: "false" }), undefined);

  const worktree = scratch();
  fs.mkdirSync(path.join(worktree, "nested"), { recursive: true });
  writeFileSync(path.join(worktree, ".git"), "gitdir: /repo/.git/worktrees/wt\n");
  assert.match(
    detectEphemeralStore(path.join(worktree, "nested"), { TMPDIR: "/no/such" }),
    /inside the linked git worktree/,
  );

  const checkout = scratch();
  fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
  assert.equal(detectEphemeralStore(checkout, { TMPDIR: "/no/such" }), undefined);
});

test("a config file's receipts and mutation sections are read without loading the whole config", () => {
  const dir = scratch();
  const configPath = path.join(dir, "tc.yaml");
  writeFileSync(
    configPath,
    "version: '2.0'\nname: x\ntargets: {}\nreceipts:\n  dir: './r'\n  ephemeral: true\nmutation:\n  allow_origins: ['https://a.example']\n",
  );
  const section = readConfigReceiptsSection(configPath);
  assert.deepEqual(section.receipts, { dir: "./r", ephemeral: true });
  assert.deepEqual(section.mutation, { allowOrigins: ["https://a.example"] });

  assert.deepEqual(readConfigReceiptsSection(path.join(dir, "missing.yaml")), {});
  writeFileSync(path.join(dir, "broken.yaml"), "a: [1,\n");
  assert.deepEqual(readConfigReceiptsSection(path.join(dir, "broken.yaml")), {});
  writeFileSync(path.join(dir, "list.yaml"), "- one\n");
  assert.deepEqual(readConfigReceiptsSection(path.join(dir, "list.yaml")), {});
  writeFileSync(path.join(dir, "wrong.yaml"), "receipts:\n  ephemeral: 'yes please'\n");
  assert.throws(() => readConfigReceiptsSection(path.join(dir, "wrong.yaml")));

  const minted = createRunContext({
    operationId: "test",
    effect: READ_ONLY,
    input: { config: configPath },
    env: {},
    cwd: dir,
  });
  assert.equal(minted.config.receipts.dir, path.join(dir, "r"));
  assert.equal(minted.config.receipts.ephemeral, true);
  assert.deepEqual(minted.config.mutation.allowOrigins, ["https://a.example"]);
  assert.match(minted.runId, /^[0-9a-f-]{36}$/);
  assert.equal(minted.operationId, "test");
  assert.deepEqual(Object.keys(minted.adapters).sort(), ["bombadil", "cli", "surf"]);
  assert.equal(minted.receiptStore.dir, path.join(dir, "r"));
  assert.equal(minted.ledger.receipts().length, 0);
});
