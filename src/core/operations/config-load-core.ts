import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { TestCapabilitiesConfig } from "../config.js";
import { TestCapabilitiesConfigSchema } from "../config.js";
import { FrameworkError } from "../runtime-contract.js";

export function loadConfig(file: string): TestCapabilitiesConfig {
  const configPath = path.resolve(file);

  if (!fs.existsSync(configPath)) {
    throw new FrameworkError("config_not_found", `Config file not found: ${configPath}`, {
      path: configPath,
    });
  }

  const configText = fs.readFileSync(configPath, "utf8");
  const raw = yaml.load(configText) ?? {};
  const parsed = TestCapabilitiesConfigSchema.parse(raw);
  return parsed;
}
