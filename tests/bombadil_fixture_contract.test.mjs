import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;

function load(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("Bombadil richer fixture pages expose the expected interactive surfaces", () => {
  const indexHtml = load("examples/bombadil-rich/site/index.html");
  const aboutHtml = load("examples/bombadil-rich/site/about.html");

  assert.match(indexHtml, /Bombadil Rich Fixture/);
  assert.match(indexHtml, /Toggle details/);
  assert.match(indexHtml, /mode-select/);
  assert.match(indexHtml, /item-form/);
  assert.match(indexHtml, /confirm-box/);
  assert.match(indexHtml, /about\.html/);

  assert.match(aboutHtml, /Return to the main fixture/);
  assert.match(aboutHtml, /intra-origin navigation/);
});

test("Bombadil richer smoke script advertises reusable runner controls", () => {
  const scriptPath = new URL("../scripts/bombadil-rich-smoke.sh", import.meta.url).pathname;
  const result = spawnSync("bash", [scriptPath, "--help"], {
    encoding: "utf8",
    cwd: repoRoot,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Run a richer local Bombadil regression smoke/);
  assert.match(result.stdout, /--direct-only/);
  assert.match(result.stdout, /--tc-only/);
  assert.match(result.stdout, /--keep-temp/);
});
