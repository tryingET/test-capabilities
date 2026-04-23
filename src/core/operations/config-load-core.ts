import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { TestCapabilitiesConfig } from "../orchestrator.js";
import { TestCapabilitiesConfigSchema } from "../orchestrator.js";

export function loadConfig(file: string): TestCapabilitiesConfig {
  const configPath = path.resolve(file);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const configText = fs.readFileSync(configPath, "utf8");
  const raw = yaml.load(configText) ?? {};
  const parsed = TestCapabilitiesConfigSchema.parse(raw);
  return parsed;
}
