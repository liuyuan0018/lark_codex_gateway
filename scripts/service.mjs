import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadGatewayConfig } from "./config.mjs";
import {
  gatewayDashboardUrl,
  getGatewayHealth,
  healthMatches,
  startGateway,
  stopGateway,
} from "./service-manager.mjs";

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
);
const { config, configPath, fingerprint: configFingerprint } = await loadGatewayConfig(pluginRoot);
const command = process.argv[2] || "status";
const options = {
  pluginRoot,
  config,
  configPath,
  configFingerprint,
  expectedVersion: manifest.version,
};

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (command === "status") {
  const health = await getGatewayHealth(config).catch(() => null);
  print(health
    ? {
        running: true,
        currentConfiguration: healthMatches(health, manifest.version, configFingerprint),
        dashboardUrl: gatewayDashboardUrl(config),
        health,
      }
    : { running: false, dashboardUrl: gatewayDashboardUrl(config) });
} else if (command === "start") {
  print(await startGateway(options));
} else if (command === "restart") {
  print(await startGateway({ ...options, replaceExisting: true }));
} else if (command === "stop") {
  print(await stopGateway(config));
} else {
  process.stderr.write("Usage: node scripts/service.mjs <start|stop|restart|status>\n");
  process.exitCode = 2;
}
