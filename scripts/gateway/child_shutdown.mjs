function waitForChildExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const done = () => resolve(true);
    child.once("exit", done);
    child.once("error", done);
  });
}

function timeout(milliseconds) {
  return new Promise((resolve) => setTimeout(() => resolve(false), milliseconds));
}

export function processGroupExists(processGroupId) {
  if (process.platform === "win32" || !Number.isSafeInteger(processGroupId) || processGroupId <= 0) {
    return false;
  }
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    if (error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function signalChild(child, signal, processGroupId) {
  if (process.platform !== "win32" && processGroupId) {
    try {
      process.kill(-processGroupId, signal);
      return;
    } catch (error) {
      if (error.code !== "ESRCH") {
        throw error;
      }
    }
  }
  child.kill(signal);
}

async function waitForChildAndGroup(exitPromise, processGroupId, timeoutMs, groupExists) {
  const deadline = Date.now() + timeoutMs;
  let childExited = false;
  exitPromise.then(() => {
    childExited = true;
  });
  while (Date.now() < deadline) {
    if (childExited && !groupExists(processGroupId)) {
      return true;
    }
    await timeout(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return childExited && !groupExists(processGroupId);
}

export async function terminateChildProcess(child, {
  graceMs = 3000,
  killWaitMs = 3000,
  processGroupId = null,
  groupExists = processGroupExists,
  sendSignal = signalChild,
} = {}) {
  if (!child) {
    return { exited: true, forced: false };
  }
  const childExited = child.exitCode !== null || child.signalCode !== null;
  if (childExited && !groupExists(processGroupId)) {
    return { exited: true, forced: false };
  }
  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.end();
  }
  const exitPromise = waitForChildExit(child);
  sendSignal(child, "SIGTERM", processGroupId);
  if (await waitForChildAndGroup(exitPromise, processGroupId, graceMs, groupExists)) {
    return { exited: true, forced: false };
  }
  sendSignal(child, "SIGKILL", processGroupId);
  const exited = await waitForChildAndGroup(exitPromise, processGroupId, killWaitMs, groupExists);
  if (!exited) {
    throw new Error(`子进程 ${child.pid ?? "(unknown)"} 在 SIGKILL 后仍未退出`);
  }
  return { exited: true, forced: true };
}
