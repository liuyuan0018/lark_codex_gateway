import { execFile, spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function capture(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function inside(directory, file) {
  const relative = path.win32.relative(directory, file);
  return relative && !relative.startsWith("..") && !path.win32.isAbsolute(relative);
}

async function probe(command, prefixArgs = []) {
  try {
    const version = await capture(command, [...prefixArgs, "--version"]);
    const match = version.match(/^codex-cli (\d+)\.(\d+)\.(\d+)([^\s]*)/);
    if (!match) return null;
    return { command, prefixArgs, version, numbers: match.slice(1, 4).map(Number), prerelease: match[4] };
  } catch {
    return null;
  }
}

function newestFirst(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return b.numbers[index] - a.numbers[index];
  }
  if (!a.prerelease !== !b.prerelease) return a.prerelease ? 1 : -1;
  return b.prerelease.localeCompare(a.prerelease, "en", { numeric: true }) || a.command.localeCompare(b.command);
}

export async function resolveCodexExecutable({ command = "auto", prefixArgs = [] } = {}) {
  if (process.platform !== "win32") {
    return { command: command === "auto" ? "codex" : command, prefixArgs };
  }
  const root = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin") : "";
  // 自定义命令保持原样；旧配置中的桌面版路径在每次启动前重新定位。
  if (command !== "auto" && !(root && inside(root, command))) return { command, prefixArgs };

  if (root) {
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    let running = [];
    try {
      const output = await capture(powershell, ["-NoProfile", "-NonInteractive", "-Command",
        "Get-Process -Name codex -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique"]);
      running = output.split(/\r?\n/).filter((file) => inside(root, file));
    } catch { /* 无法读取进程时继续检查安装目录。 */ }
    const active = (await Promise.all(running.map((file) => probe(file)))).filter(Boolean).sort(newestFirst);
    if (active.length) return active[0];

    let entries = [];
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const candidates = entries.filter((entry) => entry.isDirectory() && /^[a-f0-9]+$/i.test(entry.name))
      .map((entry) => path.join(root, entry.name, "codex.exe"));
    const installed = (await Promise.all(candidates.map((file) => probe(file)))).filter(Boolean).sort(newestFirst);
    if (installed.length) return installed[0];
    const legacy = await probe(path.join(root, "codex.exe"));
    if (legacy) return legacy;
  }
  // 显式配置了桌面版时，不静默切换到可能不兼容的 npm 版本。
  if (command !== "auto") throw new Error("找不到可运行的桌面版 Codex；请检查安装目录或设置 codexCliCommand。");
  const entry = path.join(process.env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  const npm = await probe(process.execPath, [entry]);
  if (npm) return npm;
  throw new Error("找不到可运行的 Codex；请安装 Codex 或设置 codexCliCommand。");
}

export async function spawnCodexAppServer(invocation, options) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolved = await resolveCodexExecutable(invocation);
    const child = spawn(resolved.command, [...resolved.prefixArgs, "app-server", "--listen", "stdio://"], options);
    try {
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      console.error(JSON.stringify({ time: new Date().toISOString(), message: "Codex App Server 已启动",
        command: resolved.command, version: resolved.version || "custom", processId: child.pid }));
      return child;
    } catch (error) {
      // 只重试尚未启动的进程；回合开始后的错误不能重放用户请求。
      if (attempt || error.code !== "ENOENT") throw error;
    }
  }
}
