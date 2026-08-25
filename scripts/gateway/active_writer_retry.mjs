const ACTIVE_WRITER_TEXT = "already has an active writer";

export function isActiveWriterConflict(error) {
  return error?.rpcMethod === "thread/resume" &&
    error?.rpcCode === -32600 &&
    typeof error?.rpcMessage === "string" &&
    error.rpcMessage.toLowerCase().includes(ACTIVE_WRITER_TEXT);
}

export async function runWithActiveWriterRetry(operation, {
  maxAttempts = 8,
  initialDelayMs = 1000,
  maxDelayMs = 15000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  onRetry = () => {},
} = {}) {
  const startedAt = now();
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt, elapsedMs: now() - startedAt };
    } catch (error) {
      if (!isActiveWriterConflict(error) || attempt >= maxAttempts) {
        if (isActiveWriterConflict(error)) {
          error.activeWriterRetryAttempts = attempt;
          error.activeWriterRetryElapsedMs = now() - startedAt;
        }
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, initialDelayMs * (2 ** (attempt - 1)));
      await onRetry({ attempt, nextAttempt: attempt + 1, delayMs, elapsedMs: now() - startedAt });
      await sleep(delayMs);
    }
  }
  throw new Error("active writer 重试状态异常");
}
