import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { gatewayEnvironment } from "./config.mjs";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function gatewayDashboardUrl(config) {
  const host = ["0.0.0.0", "::", "[::]"].includes(config.dashboardHost)
    ? "127.0.0.1"
    : config.dashboardHost;
  return `http://${host}:${config.dashboardPort}`;
}

export async function getGatewayHealth(config, timeoutMs = 2500) {
  const response = await fetch(`${gatewayDashboardUrl(config)}/api/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

export function healthMatches(health, expectedVersion, configFingerprint) {
  return health?.connectionState === "connected" &&
    health?.gatewayVersion === expectedVersion &&
    health?.configFingerprint === configFingerprint;
}

export async function stopGateway(config, health = null) {
  const current = health ?? await getGatewayHealth(config).catch(() => null);
  if (!current) {
    return { stopped: false, reason: "not_running" };
  }
  if (current.ok !== true || typeof current.gatewayVersion !== "string") {
    throw new Error(`端口 ${config.dashboardPort} 上的服务不是可识别的飞书 Codex 网关`);
  }
  const processId = Number.parseInt(current.processId, 10);
  if (!Number.isSafeInteger(processId) || processId <= 0 || processId === process.pid) {
    throw new Error("网关健康信息没有可停止的进程 ID");
  }
  try {
    process.kill(processId, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") {
      return { stopped: false, reason: "not_running", processId };
    }
    throw error;
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await wait(200);
    try {
      const next = await getGatewayHealth(config);
      if (next.processId !== processId) {
        return { stopped: true, processId };
      }
    } catch {
      return { stopped: true, processId };
    }
  }
  throw new Error(`网关进程 ${processId} 未能在 10 秒内停止`);
}

export async function startGateway({
  pluginRoot,
  config,
  configPath,
  configFingerprint,
  expectedVersion,
  replaceExisting = false,
}) {
  const current = await getGatewayHealth(config).catch(() => null);
  if (current && healthMatches(current, expectedVersion, configFingerprint) && !replaceExisting) {
    return { health: current, started: false, logs: null };
  }
  if (current && !replaceExisting) {
    throw new Error(
      `端口 ${config.dashboardPort} 已有网关运行，但版本或配置不同；请执行 restart`,
    );
  }
  if (current && replaceExisting) {
    await stopGateway(config, current);
  }

  const logsDirectory = path.join(config.stateDir, "logs");
  await mkdir(logsDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stdoutLog = path.join(logsDirectory, `gateway-${timestamp}.out.log`);
  const stderrLog = path.join(logsDirectory, `gateway-${timestamp}.err.log`);
  const stdoutFd = openSync(stdoutLog, "a");
  const stderrFd = openSync(stderrLog, "a");
  const gatewayEntry = path.join(pluginRoot, "scripts", "gateway", "gateway.mjs");
  let child;
  let spawnError = null;
  try {
    child = spawn(process.execPath, [gatewayEntry], {
      cwd: config.codexWorkdir,
      env: { ...process.env, ...gatewayEnvironment(config, configFingerprint, configPath) },
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref();
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const deadline = Date.now() + config.readyTimeoutMs;
  while (Date.now() < deadline) {
    await wait(250);
    if (spawnError) {
      throw new Error(`启动网关失败：${spawnError.message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`网关启动进程已退出，退出码 ${child.exitCode}。日志：${stderrLog}`);
    }
    try {
      const health = await getGatewayHealth(config);
      if (healthMatches(health, expectedVersion, configFingerprint)) {
        return {
          health,
          started: true,
          logs: { stdout: stdoutLog, stderr: stderrLog },
        };
      }
    } catch {
      // The dashboard is not ready yet.
    }
  }
  throw new Error(`等待飞书网关就绪超时。日志：${stderrLog}`);
}

export async function ensureGateway(options) {
  const current = await getGatewayHealth(options.config).catch(() => null);
  if (healthMatches(current, options.expectedVersion, options.configFingerprint)) {
    return current;
  }
  const result = await startGateway({ ...options, replaceExisting: Boolean(current) });
  return result.health;
}
