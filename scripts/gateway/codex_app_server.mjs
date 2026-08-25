import { spawn } from "node:child_process";
import readline from "node:readline";

import { prepareCodexEnvironment } from "./codex_environment.mjs";

function appendCaptured(current, chunk, maxChars = 20000) {
  return `${current}${chunk}`.slice(-maxChars);
}

function latestFinalMessage(turn, completedMessages) {
  const turnMessages = (turn?.items ?? []).filter((item) => item.type === "agentMessage");
  const messages = [...completedMessages, ...turnMessages];
  return (
    [...messages].reverse().find((item) => item.phase === "final_answer") ??
    [...messages].reverse().find((item) => item.phase !== "commentary") ??
    messages.at(-1)
  );
}

export function buildThreadStartParams({ cwd, model, effort }) {
  return {
    cwd,
    model,
    config: { model_reasoning_effort: effort },
  };
}

export function buildThreadResumeParams({ threadId, cwd, model, effort }) {
  return {
    threadId,
    cwd,
    model,
    config: { model_reasoning_effort: effort },
    excludeTurns: true,
  };
}

export function buildTurnStartParams({ threadId, input, cwd, model, effort }) {
  return {
    threadId,
    input,
    cwd,
    model,
    effort,
  };
}

async function runCodexAppServer(options) {
  const {
    command,
    prefixArgs = [],
    threadId = null,
    threadTitle = "",
    prompt = null,
    localImages = [],
    cwd,
    model = "gpt-5.6-sol",
    effort = "high",
    timeoutMs,
    clientName = "lark-codex-gateway",
    clientTitle = "Lark Codex Gateway",
    clientVersion = "1.0.0",
  } = options;

  const codexEnvironment = await prepareCodexEnvironment(process.env);

  const child = spawn(
    command,
    [...prefixArgs, "app-server", "--listen", "stdio://"],
    {
      cwd,
      env: codexEnvironment.environment,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let nextRequestId = 1;
  let stderr = "";
  let exited = false;
  let turnId = null;
  let timeout = null;
  const pendingRequests = new Map();
  const completedTurns = new Map();
  const turnWaiters = new Map();
  const completedMessages = [];

  const rejectPending = (error) => {
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
    for (const waiter of turnWaiters.values()) {
      waiter.reject(error);
    }
    turnWaiters.clear();
  };

  const writeMessage = (message) => {
    if (exited || child.stdin.destroyed) {
      throw new Error("Codex App Server 输入流已经关闭");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  };

  const request = (method, params) => {
    const id = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject, method });
      writeMessage({ method, id, params });
    });
  };

  const waitForTurn = (id) => {
    const completed = completedTurns.get(id);
    if (completed) {
      return Promise.resolve(completed);
    }
    return new Promise((resolve, reject) => {
      turnWaiters.set(id, { resolve, reject });
    });
  };

  const stdoutReader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  stdoutReader.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      rejectPending(new Error(`Codex App Server 返回了无效 JSON: ${error.message}`));
      return;
    }

    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const pending = pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(message.id);
      if (message.error) {
        const error = new Error(`${pending.method} 失败: ${JSON.stringify(message.error)}`);
        error.rpcCode = message.error.code;
        error.rpcMessage = message.error.message;
        error.rpcMethod = pending.method;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      writeMessage({
        id: message.id,
        error: {
          code: -32601,
          message: `飞书网关无法处理 App Server 请求: ${message.method}`,
        },
      });
      return;
    }

    if (message.method === "item/completed") {
      const item = message.params?.item;
      if (message.params?.turnId === turnId && item?.type === "agentMessage") {
        completedMessages.push(item);
      }
      return;
    }

    if (message.method === "turn/completed") {
      const completedTurn = message.params?.turn;
      const completedTurnId = completedTurn?.id;
      if (!completedTurnId) {
        return;
      }
      completedTurns.set(completedTurnId, completedTurn);
      const waiter = turnWaiters.get(completedTurnId);
      if (waiter) {
        turnWaiters.delete(completedTurnId);
        waiter.resolve(completedTurn);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr = appendCaptured(stderr, chunk.toString("utf8"));
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      rejectPending(error);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      exited = true;
      const result = { code, signal };
      if (pendingRequests.size > 0 || turnWaiters.size > 0) {
        rejectPending(
          new Error(
            `Codex App Server 在回合完成前退出，退出码 ${code ?? "null"}，信号 ${signal ?? "none"}` +
              `${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      }
      resolve(result);
    });
  });

  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      const error = new Error(`Codex App Server 处理超时（${timeoutMs}ms）`);
      rejectPending(error);
      child.kill("SIGTERM");
    }, timeoutMs);
  }

  try {
    await request("initialize", {
      clientInfo: { name: clientName, title: clientTitle, version: clientVersion },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    writeMessage({ method: "initialized" });
    let activeThreadId = threadId;
    let created = false;
    if (activeThreadId) {
      await request("thread/resume", buildThreadResumeParams({
        threadId: activeThreadId,
        cwd,
        model,
        effort,
      }));
    } else {
      const startedThread = await request(
        "thread/start",
        buildThreadStartParams({ cwd, model, effort }),
      );
      activeThreadId = startedThread?.thread?.id;
      if (!activeThreadId) {
        throw new Error("thread/start 响应中缺少 thread.id");
      }
      created = true;
      if (threadTitle) {
        await request("thread/name/set", {
          threadId: activeThreadId,
          name: threadTitle,
        });
      }
    }
    if (prompt === null) {
      return { threadId: activeThreadId, threadTitle, created };
    }
    const input = [{ type: "text", text: prompt, text_elements: [] }];
    for (const imagePath of localImages) {
      if (typeof imagePath === "string" && imagePath.trim()) {
        input.push({ type: "localImage", path: imagePath });
      }
    }
    const started = await request(
      "turn/start",
      buildTurnStartParams({ threadId: activeThreadId, input, cwd, model, effort }),
    );
    turnId = started?.turn?.id;
    if (!turnId) {
      throw new Error("turn/start 响应中缺少 turn.id");
    }
    const completedTurn = await waitForTurn(turnId);
    if (completedTurn.status !== "completed") {
      throw new Error(
        `Codex 回合状态为 ${completedTurn.status}` +
          `${completedTurn.error?.message ? `: ${completedTurn.error.message}` : ""}`,
      );
    }
    const finalMessage = latestFinalMessage(completedTurn, completedMessages);
    const response = finalMessage?.text?.trim();
    return {
      response: response || "Codex 已完成处理，但没有返回文本。",
      turnId,
      threadId: activeThreadId,
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    const exitResult = await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]).catch(() => null);
    if (!exitResult && !exited) {
      child.kill("SIGTERM");
    }
  }
}

export async function createCodexAppServerThread(options) {
  return runCodexAppServer({ ...options, threadId: null, prompt: null });
}

export async function runCodexAppServerTurn(options) {
  return runCodexAppServer(options);
}
