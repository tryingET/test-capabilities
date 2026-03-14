import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import process from "node:process";

const [rootArg, portFileArg] = process.argv.slice(2);

if (!rootArg || !portFileArg) {
  throw new Error("Usage: node ./scripts/capability-fixture-server.mjs <root> <port-file>");
}

const root = resolve(rootArg);
const portFile = resolve(portFileArg);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function respond(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    respond(res, 400, "missing url");
    return;
  }

  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    respond(res, 405, "method not allowed");
    return;
  }

  const requestUrl = new URL(req.url, "http://127.0.0.1");
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }

  const filePath = resolve(root, `.${pathname}`);
  if (!filePath.startsWith(root)) {
    respond(res, 403, "forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      respond(res, 404, "not found");
      return;
    }

    const contentType = mimeTypes.get(extname(filePath)) ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": String(fileStat.size),
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(await readFile(filePath));
  } catch {
    respond(res, 404, "not found");
  }
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("could not determine capability fixture server address");
  }

  await writeFile(portFile, String(address.port), "utf8");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
