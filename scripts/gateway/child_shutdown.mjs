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

export async function terminateChildProcess(child, {
  graceMs = 3000,
  killWaitMs = 3000,
} = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return { exited: true, forced: false };
  }
  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.end();
  }
  const exitPromise = waitForChildExit(child);
  child.kill("SIGTERM");
  if (await Promise.race([exitPromise, timeout(graceMs)])) {
    return { exited: true, forced: false };
  }
  child.kill("SIGKILL");
  const exited = await Promise.race([exitPromise, timeout(killWaitMs)]);
  if (!exited) {
    throw new Error(`子进程 ${child.pid ?? "(unknown)"} 在 SIGKILL 后仍未退出`);
  }
  return { exited: true, forced: true };
}
