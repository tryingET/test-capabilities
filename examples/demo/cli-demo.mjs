#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`test-capabilities demo CLI

Usage:
  demo-cli --help
  demo-cli echo <message>

This fixture is intentionally tiny and has no external runtime requirements.`);
  process.exit(0);
}

if (args[0] === "echo") {
  console.log(args.slice(1).join(" "));
  process.exit(0);
}

console.error("demo-cli: unsupported command; run with --help");
process.exit(1);
