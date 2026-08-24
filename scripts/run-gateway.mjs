import path from "node:path";
import { fileURLToPath } from "node:url";

import { gatewayEnvironment, loadGatewayConfig } from "./config.mjs";

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { config, configPath, fingerprint } = await loadGatewayConfig(pluginRoot);
Object.assign(process.env, gatewayEnvironment(config, fingerprint, configPath));
await import("./gateway/gateway.mjs");
