#!/usr/bin/env node
/**
 * A throwaway `node:http` server with one form, which records what it receives.
 *
 * The submit gate's only honest live proof is a submit against a world the run owns
 * (submit-gate packet §9, "Local live submit proof", and School 3 of its refinement): this
 * server is that world. It serves one search form on `/`, records every POST body it receives,
 * and redirects to `/done` so a post-condition has something to observe.
 *
 * Two consumers:
 *   - the contract suite starts it in-process and asserts that exactly one POST arrives;
 *   - the live dogfood runs it standalone (`node tests/fixtures/form-fixture-server.mjs`) and
 *     drives it with the real surf binary in Chromium (Agent).
 */
import { createServer } from "node:http";
import process from "node:process";

const FORM_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Fixture form</title></head>
  <body>
    <h1>Fixture form</h1>
    <form id="search" action="/submit" method="post">
      <label for="q">Search packages</label>
      <input id="q" name="q" type="search" value="">
      <button id="search-submit" type="submit">Search</button>
      <button id="set-bid" type="button" onclick="document.title='set-bid clicked'">Set bid</button>
    </form>
  </body>
</html>
`;

const DONE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Submitted</title></head>
  <body><h1>Submitted</h1><p id="result">the fixture recorded one submission</p></body>
</html>
`;

/** Start the fixture on an ephemeral loopback port. */
export async function startFormFixtureServer(options = {}) {
  const posts = [];
  const requests = [];
  const server = createServer((request, response) => {
    // A client that sent its request and went away is the normal case here: the fake browser
    // does not wait for the reply. Recording what arrived is the point; answering is optional.
    request.on("error", () => {});
    response.on("error", () => {});
    requests.push({ method: request.method, url: request.url });
    if (request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        posts.push({ url: request.url, body });
        response.writeHead(303, { location: "/done" });
        response.end();
      });
      return;
    }
    if (request.url === "/__posts") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ posts, requests }));
      return;
    }
    if (request.url === "/done") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(DONE_HTML);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(options.html ?? FORM_HTML);
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/`,
    doneUrl: `http://127.0.0.1:${port}/done`,
    submitUrl: `http://127.0.0.1:${port}/submit`,
    posts: () => [...posts],
    requests: () => [...requests],
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const portArgument = process.argv.indexOf("--port");
  const port = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : 0;
  const fixture = await startFormFixtureServer({ port });
  console.log(JSON.stringify({ url: fixture.url, origin: fixture.origin, port: fixture.port }));
  const report = setInterval(() => {
    const posts = fixture.posts();
    if (posts.length > 0) {
      console.log(JSON.stringify({ posts }));
    }
  }, 1000);
  process.on("SIGINT", async () => {
    clearInterval(report);
    console.log(JSON.stringify({ posts: fixture.posts(), requests: fixture.requests() }));
    await fixture.close();
    process.exit(0);
  });
}
