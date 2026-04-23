import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function load(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("CLI docs reflect the fail-closed capability contract", () => {
  const cliDoc = load("docs/api/cli.md");

  assert.match(cliDoc, /Runtime capability summary/);
  assert.match(cliDoc, /CLI_OPERATION_REGISTRY/);
  assert.match(cliDoc, /`predict` \| unsupported/);
  assert.match(cliDoc, /`surf explore` \| implemented/);
  assert.match(cliDoc, /quantum\.enabled: true/);
  assert.match(cliDoc, /enabled `bombadil` agent/);
  assert.match(cliDoc, /TEST_CAPABILITIES_BOMBADIL_REPO/);
  assert.match(cliDoc, /softwareco\/contrib\/bombadil/);
  assert.match(
    cliDoc,
    /does \*\*not\*\* replace `targets\.cli` when `cli-tester` is still enabled/,
  );
  assert.match(cliDoc, /kernel no longer defaults to `about:blank`/);
  assert.match(cliDoc, /Required target URL for the simulator/);
  assert.match(cliDoc, /Fails with an unsupported-option error/);
  assert.doesNotMatch(cliDoc, /Accepted by the wrapper/);
  assert.doesNotMatch(cliDoc, /Run ML-powered failure prediction/);
});

test("getting-started docs no longer advertise unsupported autonomous flags as runnable examples", () => {
  const gettingStartedDoc = load("docs/api/getting-started.md");

  assert.match(gettingStartedDoc, /Node\.js 22\+/);
  assert.doesNotMatch(gettingStartedDoc, /test-capabilities test .*--autonomous/);
  assert.doesNotMatch(gettingStartedDoc, /Health Score: 94/);
  assert.match(
    gettingStartedDoc,
    /user=unmeasured api=unmeasured edge=100% overall=partial\(100%\)/,
  );
  assert.match(gettingStartedDoc, /Coverage gaps: userFlows, apiEndpoints/);
});

test("config docs show the strict fail-closed surface instead of legacy top-level sections", () => {
  const configDoc = load("docs/api/config.md");

  assert.match(configDoc, /Rejected top-level keys/);
  assert.match(configDoc, /Runtime-supported types:\s*- `bombadil`\s*- `cli-tester`/s);
  assert.match(configDoc, /TEST_CAPABILITIES_BOMBADIL_REPO/);
  assert.doesNotMatch(configDoc, /^reporting:/m);
  assert.doesNotMatch(configDoc, /^alerts:/m);
  assert.doesNotMatch(configDoc, /^execution:/m);
});

test("agent entrypoint routes only to supported CLI surfaces and correct doc paths", () => {
  const agentsDoc = load("src/TEST-CAPABILITIES-AGENTS.md");

  assert.match(agentsDoc, /test-capabilities test --config <file>/);
  assert.doesNotMatch(agentsDoc, /→\s+test-capabilities predict --target/);
  assert.doesNotMatch(agentsDoc, /→\s+test-capabilities test .*--autonomous/);
  assert.match(agentsDoc, /\.\.\/docs\/api\/cli\.md/);
  assert.match(agentsDoc, /\.\.\/docs\/api\/api-surf\.md/);
});

test("product readme no longer advertises unpublished package names or unsupported commands", () => {
  const readmeDoc = load("docs/TEST-CAPABILITIES-README.md");

  assert.doesNotMatch(readmeDoc, /@test-capabilities\/framework/);
  assert.doesNotMatch(readmeDoc, /test-capabilities predict\s+#/);
  assert.match(readmeDoc, /unsupported surfaces fail clearly/i);
});

test("prediction API docs describe the library surface instead of a supported CLI command", () => {
  const predictionDoc = load("docs/api/api-prediction.md");

  assert.match(predictionDoc, /library surface/i);
  assert.doesNotMatch(predictionDoc, /test-capabilities predict --target/);
  assert.match(predictionDoc, /const stop = await collector\.startCollection\(60000\)/);
});

test("healing API docs avoid unsupported CLI flags and explain line-targeted application", () => {
  const healingDoc = load("docs/api/api-healing.md");

  assert.doesNotMatch(healingDoc, /--confidence/);
  assert.match(healingDoc, /targets the proposal's recorded line/i);
  assert.match(healingDoc, /skips common generated\/dependency directories/i);
  assert.match(healingDoc, /ordinary payload literals/i);
  assert.match(healingDoc, /applyProposals/i);
});

test("quantum API docs avoid unsupported CLI flags and document target/branch validation", () => {
  const quantumDoc = load("docs/api/api-quantum.md");

  assert.doesNotMatch(quantumDoc, /--strategy diversity/);
  assert.match(quantumDoc, /positive integer branch count/i);
  assert.match(quantumDoc, /must be a valid URL/i);
  assert.doesNotMatch(quantumDoc, /bug\.impact/);
  assert.match(quantumDoc, /Severity: \$\{bug\.severity\}/);
});

test("types docs reflect the tightened quantum and healing contracts", () => {
  const typesDoc = load("docs/api/types.md");

  assert.match(typesDoc, /target` is required and must be a valid URL/i);
  assert.match(typesDoc, /status: CoverageStatus;/);
  assert.match(typesDoc, /column\?: number;/);
});

test("api reference shows the operation kernel and a capability-backed orchestrator example", () => {
  const apiReferenceDoc = load("docs/api/api-reference.md");

  assert.match(apiReferenceDoc, /packed artifact/i);
  assert.doesNotMatch(apiReferenceDoc, /npm install test-capabilities/);
  assert.match(apiReferenceDoc, /executeCliOperation/);
  assert.match(apiReferenceDoc, /CLI_OPERATION_REGISTRY/);
  assert.match(apiReferenceDoc, /type: 'cli-tester'/);
  assert.match(apiReferenceDoc, /targets:\s*\{\s*cli: 'node'/s);
  assert.match(apiReferenceDoc, /`bombadil` and\/or `cli-tester`/);
  assert.match(apiReferenceDoc, /validateCapabilityContract/);
});

test("examples docs include the repo-local capability drill", () => {
  const examplesDoc = load("docs/api/examples.md");
  const readmeDoc = load("README.md");

  assert.match(examplesDoc, /npm run capability:drill/);
  assert.match(examplesDoc, /TEST_CAPABILITIES_BOMBADIL_REPO/);
  assert.match(examplesDoc, /npm run bombadil:smoke/);
  assert.match(examplesDoc, /--direct-only/);
  assert.match(examplesDoc, /--surf-mode shim/);
  assert.match(examplesDoc, /--surf-mode real/);
  assert.match(examplesDoc, /--json --surf-mode shim --skip-build/);
  assert.match(readmeDoc, /npm run bombadil:smoke/);
  assert.match(readmeDoc, /examples\/bombadil-rich\/site\//);
  assert.match(readmeDoc, /structured summary with `ok`, `surfMode`, `summary`/);
});

test("surf API docs avoid unsupported examples and mark file workflows as library passthrough", () => {
  const surfDoc = load("docs/api/api-surf.md");

  assert.doesNotMatch(surfDoc, /\{ all: true \}/);
  assert.doesNotMatch(surfDoc, /await surf\.select\('e5', 0/);
  assert.match(surfDoc, /test-capabilities surf explore/);
  assert.match(surfDoc, /library-level passthrough/i);
  assert.match(surfDoc, /fails clearly instead of being accepted and silently ignored/i);
  assert.match(surfDoc, /warning-prefixed output/i);
});

test("errors docs include newly fail-closed quantum and surf config cases", () => {
  const errorsDoc = load("docs/api/errors.md");

  assert.match(errorsDoc, /Quantum simulation requires --target with a valid URL/);
  assert.match(errorsDoc, /Quantum target must be a valid URL/);
  assert.match(errorsDoc, /Surf explore target must be a valid URL/);
  assert.match(errorsDoc, /Invalid JSON output from surf network/);
  assert.match(errorsDoc, /Unsupported SurfClient config option\(s\): socketPath/);
});
