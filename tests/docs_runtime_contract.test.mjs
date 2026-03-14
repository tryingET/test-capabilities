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
  assert.match(cliDoc, /does \*\*not\*\* replace the required `targets\.cli` smoke target/);
  assert.match(cliDoc, /Fails with an unsupported-option error/);
  assert.doesNotMatch(cliDoc, /Accepted by the wrapper/);
  assert.doesNotMatch(cliDoc, /Run ML-powered failure prediction/);
});

test("getting-started docs no longer advertise unsupported autonomous flags as runnable examples", () => {
  const gettingStartedDoc = load("docs/api/getting-started.md");

  assert.match(gettingStartedDoc, /Node\.js 22\+/);
  assert.doesNotMatch(gettingStartedDoc, /test-capabilities test .*--autonomous/);
  assert.doesNotMatch(gettingStartedDoc, /Health Score: 94/);
  assert.match(gettingStartedDoc, /overall=33%/);
});

test("config docs show the strict fail-closed surface instead of legacy top-level sections", () => {
  const configDoc = load("docs/api/config.md");

  assert.match(configDoc, /Rejected top-level keys/);
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
});

test("quantum API docs avoid unsupported CLI flags and document branch validation", () => {
  const quantumDoc = load("docs/api/api-quantum.md");

  assert.doesNotMatch(quantumDoc, /--strategy diversity/);
  assert.match(quantumDoc, /positive integer branch count/i);
});

test("api reference shows the operation kernel and a capability-backed orchestrator example", () => {
  const apiReferenceDoc = load("docs/api/api-reference.md");

  assert.match(apiReferenceDoc, /packed artifact/i);
  assert.doesNotMatch(apiReferenceDoc, /npm install test-capabilities/);
  assert.match(apiReferenceDoc, /executeCliOperation/);
  assert.match(apiReferenceDoc, /CLI_OPERATION_REGISTRY/);
  assert.match(apiReferenceDoc, /type: 'cli-tester'/);
  assert.match(apiReferenceDoc, /targets:\s*\{\s*cli: 'node'/s);
  assert.match(apiReferenceDoc, /validateCapabilityContract/);
});

test("surf API docs avoid unsupported examples and mark file workflows as library passthrough", () => {
  const surfDoc = load("docs/api/api-surf.md");

  assert.doesNotMatch(surfDoc, /\{ all: true \}/);
  assert.doesNotMatch(surfDoc, /await surf\.select\('e5', 0/);
  assert.match(surfDoc, /test-capabilities surf explore/);
  assert.match(surfDoc, /library-level passthrough/i);
});
