const RATE_LIMIT_PATTERNS = [
  /\bHTTP\s*429\b/iu,
  /\b429\s+(?:too\s+many\s+requests|rate\s+limit(?:ed)?)\b/iu,
  /\btoo\s+many\s+requests\b/iu,
  /\brate[ _-]?limit(?:ed|ing)?\b/iu,
  /请求(?:过于)?频繁|频率限制|触发限流/u,
];

function resultText(result) {
  return `${result?.stdout || ""}\n${result?.stderr || ""}`;
}

export function isLarkRateLimitResult(result) {
  return result?.code !== 0 && RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(resultText(result)));
}

export async function runWithLarkRateLimitRetry(operation, {
  maxAttempts = 5,
  initialDelayMs = 1000,
  maxDelayMs = 8000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  onRetry = () => {},
} = {}) {
  const startedAt = now();
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const value = await operation(attempt);
    const rateLimited = isLarkRateLimitResult(value);
    if (!rateLimited || attempt >= maxAttempts) {
      return {
        value,
        attempts: attempt,
        elapsedMs: now() - startedAt,
        rateLimitExhausted: rateLimited,
      };
    }
    const delayMs = Math.min(maxDelayMs, initialDelayMs * (2 ** (attempt - 1)));
    await onRetry({ attempt, nextAttempt: attempt + 1, delayMs, elapsedMs: now() - startedAt });
    await sleep(delayMs);
  }
  throw new Error("飞书限流重试状态异常");
}
