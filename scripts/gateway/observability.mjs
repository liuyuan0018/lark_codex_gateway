import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/logo.png", ["logo.png", "image/png"]],
]);

function emptyCounts() {
  return {
    total: 0,
    inbound: 0,
    outbound: 0,
    internal: 0,
    errors: 0,
    ignored: 0,
  };
}

function addToCounts(counts, event) {
  counts.total += 1;
  if (event.direction in counts) {
    counts[event.direction] += 1;
  }
  if (event.status === "error") {
    counts.errors += 1;
  }
  if (event.status === "ignored") {
    counts.ignored += 1;
  }
}

function parseLimit(value, fallback, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJsonBody(request, maximumBytes = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error("request_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("invalid_json");
    error.statusCode = 400;
    throw error;
  }
}

function searchableText(event) {
  return [
    event.content,
    event.summary,
    event.eventType,
    event.eventId,
    event.messageId,
    event.chatId,
    event.larkThreadId,
    event.fileToken,
    event.commentId,
    event.senderId,
    event.threadId,
    event.threadTitle,
    event.routeType,
    event.topicSetupId,
    event.topicSetupStatus,
    event.skillName,
    event.skillVersion,
    event.idempotencyKey,
    event.reason,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

async function loadHistory(eventsPath, maximumRecords) {
  const records = [];
  const counts = emptyCounts();
  let sequence = 0;
  try {
    const lines = readline.createInterface({
      input: createReadStream(eventsPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = JSON.parse(line);
        addToCounts(counts, event);
        records.push(event);
        if (records.length > maximumRecords) {
          records.shift();
        }
        const suffix = Number.parseInt(String(event.id ?? "").split("-").at(-1), 10);
        if (Number.isSafeInteger(suffix)) {
          sequence = Math.max(sequence, suffix);
        }
      } catch {
        counts.errors += 1;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return { records, counts, sequence };
}

export async function createObservability(options) {
  const {
    stateDir,
    publicDir,
    host = "127.0.0.1",
    port = 47931,
    maximumRecords = 5000,
    getRuntimeStatus = () => ({}),
    sendMessage = null,
    recallMessage = null,
    retryInboundMessage = null,
    listPendingOutbound = null,
    approvePendingOutbound = null,
    rejectPendingOutbound = null,
  } = options;
  await fs.mkdir(stateDir, { recursive: true });
  const eventsPath = path.join(stateDir, "traffic.ndjson");
  const history = await loadHistory(eventsPath, maximumRecords);
  const records = history.records;
  const counts = history.counts;
  const subscribers = new Set();
  let sequence = history.sequence;
  let writeTail = Promise.resolve();
  let server = null;
  let dashboardUrl = `http://${host}:${port}`;

  function publish(eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of subscribers) {
      response.write(payload);
    }
  }

  function record(fields) {
    const event = {
      id: `${Date.now()}-${++sequence}`,
      time: new Date().toISOString(),
      direction: "internal",
      kind: "system",
      stage: "observed",
      status: "info",
      content: "",
      summary: "",
      ...fields,
    };
    records.push(event);
    if (records.length > maximumRecords) {
      records.shift();
    }
    addToCounts(counts, event);
    writeTail = writeTail
      .then(() => fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8"))
      .catch((error) => {
        process.stderr.write(`observability append failed: ${error.message}\n`);
      });
    publish("traffic", event);
    publish("status", status());
    return event;
  }

  function status() {
    return {
      ok: true,
      dashboardUrl,
      persistencePath: eventsPath,
      recentRecords: records.length,
      counts: { ...counts },
      ...getRuntimeStatus(),
    };
  }

  function queryEvents(searchParams) {
    const direction = searchParams.get("direction")?.trim() || "all";
    const kind = searchParams.get("kind")?.trim() || "all";
    const statusFilter = searchParams.get("status")?.trim() || "all";
    const query = searchParams.get("query")?.trim().toLocaleLowerCase() || "";
    const after = searchParams.get("after")?.trim() || "";
    const limit = parseLimit(searchParams.get("limit"), 200, 1000);
    const filtered = records.filter((event) =>
      (direction === "all" || event.direction === direction) &&
      (kind === "all" || event.kind === kind) &&
      (statusFilter === "all" || event.status === statusFilter) &&
      (!after || event.id > after) &&
      (!query || searchableText(event).includes(query)),
    );
    return filtered.slice(-limit).reverse();
  }

  async function serveStatic(requestPath, response) {
    const descriptor = STATIC_FILES.get(requestPath);
    if (!descriptor) {
      sendJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
    const [fileName, contentType] = descriptor;
    try {
      const body = await fs.readFile(path.join(publicDir, fileName));
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": requestPath === "/" ? "no-cache" : "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: "asset_unavailable", detail: error.message });
    }
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", dashboardUrl);
    if (url.pathname === "/api/messages/retry") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!retryInboundMessage) {
        sendJson(response, 503, { ok: false, error: "message_retry_unavailable" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== dashboardUrl) {
        sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        sendJson(response, 415, { ok: false, error: "content_type_not_supported" });
        return;
      }
      try {
        const result = await retryInboundMessage(await readJsonBody(request));
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          ok: false,
          error: error.code || "message_retry_failed",
          detail: error.message,
        });
      }
      return;
    }
    if (url.pathname === "/api/messages/recall") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!recallMessage) {
        sendJson(response, 503, { ok: false, error: "message_recall_unavailable" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== dashboardUrl) {
        sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        sendJson(response, 415, { ok: false, error: "content_type_not_supported" });
        return;
      }
      try {
        const result = await recallMessage(await readJsonBody(request));
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          ok: false,
          error: error.code || "message_recall_failed",
          detail: error.message,
        });
      }
      return;
    }
    const approvalMatch = url.pathname.match(/^\/api\/pending-outbound\/([a-f0-9]+)\/approve$/);
    if (approvalMatch) {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!approvePendingOutbound) {
        sendJson(response, 503, { ok: false, error: "approval_unavailable" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== dashboardUrl) {
        sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      try {
        const result = await approvePendingOutbound(approvalMatch[1]);
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          ok: false,
          error: error.code || "approval_failed",
          detail: error.message,
        });
      }
      return;
    }
    const rejectionMatch = url.pathname.match(/^\/api\/pending-outbound\/([a-f0-9]+)\/reject$/);
    if (rejectionMatch) {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!rejectPendingOutbound) {
        sendJson(response, 503, { ok: false, error: "rejection_unavailable" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== dashboardUrl) {
        sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      try {
        const result = await rejectPendingOutbound(rejectionMatch[1]);
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          ok: false,
          error: error.code || "rejection_failed",
          detail: error.message,
        });
      }
      return;
    }
    if (url.pathname === "/api/messages") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      if (!sendMessage) {
        sendJson(response, 503, { ok: false, error: "message_sender_unavailable" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== dashboardUrl) {
        sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        sendJson(response, 415, { ok: false, error: "content_type_not_supported" });
        return;
      }
      try {
        const result = await sendMessage(await readJsonBody(request));
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          ok: false,
          error: error.code || "message_send_failed",
          detail: error.message,
        });
      }
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    if (url.pathname === "/api/health") {
      sendJson(response, 200, status());
      return;
    }
    if (url.pathname === "/api/pending-outbound") {
      sendJson(response, 200, {
        ok: true,
        messages: listPendingOutbound ? listPendingOutbound() : [],
      });
      return;
    }
    if (url.pathname === "/api/events") {
      sendJson(response, 200, { ok: true, events: queryEvents(url.searchParams), counts });
      return;
    }
    if (url.pathname === "/api/events/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
      subscribers.add(response);
      request.on("close", () => subscribers.delete(response));
      return;
    }
    await serveStatic(url.pathname, response);
  }

  async function start() {
    if (server) {
      return dashboardUrl;
    }
    server = http.createServer((request, response) => {
      void handleRequest(request, response).catch((error) => {
        sendJson(response, 500, { ok: false, error: "internal_error", detail: error.message });
      });
    });
    server.keepAliveTimeout = 65000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    dashboardUrl = `http://${host}:${address.port}`;
    return dashboardUrl;
  }

  async function stop() {
    await writeTail;
    if (!server) {
      return;
    }
    for (const response of subscribers) {
      response.end();
    }
    subscribers.clear();
    const activeServer = server;
    server = null;
    await new Promise((resolve) => activeServer.close(resolve));
  }

  return { record, status, start, stop, eventsPath };
}
