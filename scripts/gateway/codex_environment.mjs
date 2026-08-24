import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripTomlComment(line) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (quote === "'") {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlString(value) {
  const trimmed = stripTomlComment(value).trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return "";
}

function providerSectionName(line) {
  const match = stripTomlComment(line).trim().match(
    /^\[\s*model_providers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]$/,
  );
  return match ? (match[1] || match[2] || match[3]) : "";
}

export function parseCodexProviderEnvironment(configText) {
  let section = "";
  let modelProvider = "";
  const providerEnvironmentKeys = new Map();
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("[")) {
      section = providerSectionName(line);
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    const [, key, rawValue] = assignment;
    if (!section && key === "model_provider") {
      modelProvider = parseTomlString(rawValue);
    } else if (section && key === "env_key") {
      providerEnvironmentKeys.set(section, parseTomlString(rawValue));
    }
  }
  const envKey = modelProvider ? (providerEnvironmentKeys.get(modelProvider) || "") : "";
  if (envKey && !ENVIRONMENT_NAME_PATTERN.test(envKey)) {
    throw new Error(`Codex provider ${modelProvider} 配置了无效的 env_key`);
  }
  return { modelProvider, envKey };
}

function captureCommand(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let stdout = "";
    let finished = false;
    let timer = null;
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const finish = (result) => {
      if (!finished) {
        finished = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      }
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.once("error", () => finish(""));
    child.once("exit", (code) => finish(code === 0 ? stdout : ""));
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish("");
    }, timeoutMs);
    timer.unref?.();
  });
}

async function readWindowsUserEnvironment(name) {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const powershell = path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return captureCommand(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}', 'User'))`,
  ]);
}

async function readMacUserEnvironment(name) {
  return captureCommand("launchctl", ["getenv", name]);
}

async function readOperatingSystemUserEnvironment(name) {
  if (process.platform === "win32") {
    return readWindowsUserEnvironment(name);
  }
  if (process.platform === "darwin") {
    return readMacUserEnvironment(name);
  }
  return "";
}

export function codexConfigPath(environment = process.env) {
  const codexHome = environment.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "config.toml");
}

export async function prepareCodexEnvironment(baseEnvironment = process.env) {
  const configPath = codexConfigPath(baseEnvironment);
  let configText;
  try {
    configText = await readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { environment: { ...baseEnvironment }, modelProvider: "", envKey: "", source: "none" };
    }
    throw new Error(`读取 Codex 配置失败：${configPath}：${error.message}`, { cause: error });
  }
  const { modelProvider, envKey } = parseCodexProviderEnvironment(configText);
  if (!envKey) {
    return { environment: { ...baseEnvironment }, modelProvider, envKey: "", source: "none" };
  }
  const inheritedValue = baseEnvironment[envKey];
  if (typeof inheritedValue === "string" && inheritedValue) {
    return {
      environment: { ...baseEnvironment },
      modelProvider,
      envKey,
      source: "process",
    };
  }
  const userValue = (await readOperatingSystemUserEnvironment(envKey)).replace(/\r?\n$/, "");
  if (!userValue) {
    throw new Error(
      `Codex provider ${modelProvider} 需要环境变量 ${envKey}，` +
        "但网关进程和操作系统用户环境都没有该变量",
    );
  }
  return {
    environment: { ...baseEnvironment, [envKey]: userValue },
    modelProvider,
    envKey,
    source: "user_environment",
  };
}
