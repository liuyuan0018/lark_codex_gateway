const state = {
  direction: "all",
  kind: "all",
  query: "",
  live: true,
  events: [],
  selectedId: null,
  selectedProblemId: "",
  health: null,
  pendingOutbound: [],
  eventSource: null,
};

const elements = {
  connectionState: document.querySelector("#connectionState"),
  connectionText: document.querySelector("#connectionText"),
  threadLabel: document.querySelector("#threadLabel"),
  uptimeValue: document.querySelector("#uptimeValue"),
  inboundValue: document.querySelector("#inboundValue"),
  outboundValue: document.querySelector("#outboundValue"),
  ignoredValue: document.querySelector("#ignoredValue"),
  errorValue: document.querySelector("#errorValue"),
  queueValue: document.querySelector("#queueValue"),
  pendingValue: document.querySelector("#pendingValue"),
  kindFilter: document.querySelector("#kindFilter"),
  searchInput: document.querySelector("#searchInput"),
  liveToggle: document.querySelector("#liveToggle"),
  refreshButton: document.querySelector("#refreshButton"),
  trafficBody: document.querySelector("#trafficBody"),
  rowTemplate: document.querySelector("#trafficRowTemplate"),
  emptyState: document.querySelector("#emptyState"),
  resultSummary: document.querySelector("#resultSummary"),
  lastUpdated: document.querySelector("#lastUpdated"),
  detailPanel: document.querySelector("#detailPanel"),
  detailPlaceholder: document.querySelector("#detailPlaceholder"),
  detailContent: document.querySelector("#detailContent"),
  detailDirection: document.querySelector("#detailDirection"),
  detailTitle: document.querySelector("#detailTitle"),
  detailGrid: document.querySelector("#detailGrid"),
  detailMessage: document.querySelector("#detailMessage"),
  detailMetadata: document.querySelector("#detailMetadata"),
  closeDetail: document.querySelector("#closeDetail"),
  copyProblemId: document.querySelector("#copyProblemId"),
  approvalPanel: document.querySelector("#approvalPanel"),
  approvalCount: document.querySelector("#approvalCount"),
  approvalList: document.querySelector("#approvalList"),
  approvalItemTemplate: document.querySelector("#approvalItemTemplate"),
};

const directionLabels = {
  inbound: "入站",
  outbound: "出站",
  internal: "系统",
};

const kindLabels = {
  message: "聊天消息",
  doc_comment: "文档评论",
  system: "系统",
};

const stageLabels = {
  received: "已接收",
  ignored: "已忽略",
  processing: "处理中",
  thread_assigned: "任务已分配",
  topic_route_verified: "话题群已确认",
  topic_thread_initialized: "任务身份已初始化",
  session_queued: "等待 Codex",
  chat_allowed: "群已加入白名单",
  polling_started: "轮询已启动",
  polling_failed: "轮询失败",
  polling_recovered: "轮询已恢复",
  queued: "等待发送",
  sending: "正在发送",
  delivery_retry: "发送限流重试",
  recalling: "正在撤回",
  recalled: "已撤回",
  rejected: "已拒绝发送",
  codex_completed: "Codex 完成",
  no_reply: "Agent 决定不回复",
  sent: "已发送",
  failed: "失败",
  connected: "已连接",
  disconnected: "已断开",
  started: "已启动",
  stopping: "停止中",
};

const statusLabels = {
  accepted: "已接收",
  ignored: "已忽略",
  processing: "处理中",
  success: "成功",
  error: "错误",
  connected: "已连接",
  disconnected: "已断开",
  info: "信息",
  queued: "排队中",
};

function formatTime(value, includeDate = false) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: includeDate ? "2-digit" : undefined,
    day: includeDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "--";
  }
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分 ${seconds % 60} 秒`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function truncate(value, maximum = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function eventTitle(event) {
  return event.summary || stageLabels[event.stage] || event.stage || "网关事件";
}

const routeTypeLabels = {
  doc_comment_default: "文档评论默认任务",
  fixed_chat_route: "飞书会话固定任务",
  topic_thread_assignment: "飞书话题自动分配",
  chat_assignment: "飞书会话自动分配",
};

function renderHealth(health) {
  state.health = health;
  const connectionState = health.connectionState || "starting";
  elements.connectionState.dataset.state = connectionState;
  elements.connectionText.textContent = connectionState === "connected"
    ? "飞书已连接"
    : connectionState === "error"
      ? "连接错误"
      : connectionState === "disconnected"
        ? "飞书已断开"
        : "连接中";
  const assignedCount = health.chatThreadCount ?? 0;
  const fixedRouteCount = health.fixedChatRouteCount ?? 0;
  const allowedChatCount = health.allowedChatCount ?? 0;
  const topicRouteCount = health.topicChatRouteCount ?? 0;
  const topicThreadCount = health.topicThreadCount ?? 0;
  const pollChatCount = health.pollChatCount ?? health.pollChatIds?.length ?? 0;
  const activeSessionCount = health.activeSessionCount ?? 0;
  const codexRuntime = health.codexModel && health.codexReasoningEffort
    ? ` · Codex ${health.codexModel} / ${health.codexReasoningEffort}`
    : "";
  elements.threadLabel.textContent = health.defaultThreadId
    ? `${fixedRouteCount} 个普通群固定绑定 · ${allowedChatCount} 个普通群允许 · ${assignedCount} 个普通会话自动任务 · ${topicRouteCount} 个话题群配置 · ${topicThreadCount} 个话题任务 · ${pollChatCount} 个话题群轮询 · ${activeSessionCount} 个 Codex session 处理中 · 陌生群 @Bot 后自动加入 · 默认 ${health.defaultThreadId}${codexRuntime}`
    : `${fixedRouteCount} 个普通群固定绑定 · ${allowedChatCount} 个普通群允许 · ${assignedCount} 个普通会话自动任务 · ${topicRouteCount} 个话题群配置 · ${topicThreadCount} 个话题任务 · ${pollChatCount} 个话题群轮询 · ${activeSessionCount} 个 Codex session 处理中 · 陌生群 @Bot 后自动加入${codexRuntime}`;
  elements.uptimeValue.textContent = formatDuration(health.uptimeMs);
  elements.inboundValue.textContent = health.counts?.inbound ?? 0;
  elements.outboundValue.textContent = health.counts?.outbound ?? 0;
  elements.ignoredValue.textContent = health.counts?.ignored ?? 0;
  elements.errorValue.textContent = health.counts?.errors ?? 0;
  elements.queueValue.textContent = health.queueDepth ?? 0;
  elements.pendingValue.textContent = health.pendingOutboundCount ?? 0;
}

function setPendingButtonsDisabled(buttons, disabled) {
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

async function approvePendingMessage(message, approveButton, rejectButton, errorElement) {
  setPendingButtonsDisabled([approveButton, rejectButton], true);
  approveButton.textContent = "发送中…";
  errorElement.hidden = true;
  try {
    const response = await fetch(`/api/pending-outbound/${message.approvalId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || `${response.status} ${response.statusText}`);
    }
    await refreshPendingOutbound();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
    setPendingButtonsDisabled([approveButton, rejectButton], false);
    approveButton.textContent = "重新发送";
  }
}

async function rejectPendingMessage(message, approveButton, rejectButton, errorElement) {
  if (rejectButton.dataset.confirmReject !== "true") {
    rejectButton.dataset.confirmReject = "true";
    rejectButton.classList.add("is-confirming");
    rejectButton.textContent = "确认拒绝";
    setTimeout(() => {
      if (rejectButton.isConnected && !rejectButton.disabled && rejectButton.dataset.confirmReject === "true") {
        delete rejectButton.dataset.confirmReject;
        rejectButton.classList.remove("is-confirming");
        rejectButton.textContent = "拒绝授权";
      }
    }, 4000);
    return;
  }
  delete rejectButton.dataset.confirmReject;
  setPendingButtonsDisabled([approveButton, rejectButton], true);
  rejectButton.textContent = "拒绝中…";
  errorElement.hidden = true;
  try {
    const response = await fetch(`/api/pending-outbound/${message.approvalId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || `${response.status} ${response.statusText}`);
    }
    await refreshPendingOutbound();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
    setPendingButtonsDisabled([approveButton, rejectButton], false);
    rejectButton.dataset.confirmReject = "true";
    rejectButton.classList.add("is-confirming");
    rejectButton.textContent = "重试拒绝";
  }
}

function renderPendingOutbound() {
  elements.approvalList.replaceChildren();
  elements.approvalPanel.hidden = state.pendingOutbound.length === 0;
  elements.approvalCount.textContent = String(state.pendingOutbound.length);
  for (const message of state.pendingOutbound) {
    const item = elements.approvalItemTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector(".approval-meta").textContent = [
      formatTime(message.createdAt, true),
      message.threadTitle || message.larkThreadId || message.chatId,
    ].filter(Boolean).join(" · ");
    item.querySelector(".approval-content").textContent = message.content;
    const errorElement = item.querySelector(".approval-error");
    if (message.lastError) {
      errorElement.textContent = message.lastError;
      errorElement.hidden = false;
    }
    const approveButton = item.querySelector(".approve-button");
    const rejectButton = item.querySelector(".reject-button");
    approveButton.addEventListener("click", () =>
      void approvePendingMessage(message, approveButton, rejectButton, errorElement));
    rejectButton.addEventListener("click", () =>
      void rejectPendingMessage(message, approveButton, rejectButton, errorElement));
    elements.approvalList.append(item);
  }
}

function visibleEvents() {
  const query = state.query.toLocaleLowerCase();
  return state.events.filter((event) => {
    if (state.direction !== "all" && event.direction !== state.direction) {
      return false;
    }
    if (state.kind !== "all" && event.kind !== state.kind) {
      return false;
    }
    if (!query) {
      return true;
    }
    return JSON.stringify(event).toLocaleLowerCase().includes(query);
  });
}

function selectEvent(event) {
  state.selectedId = event.id;
  state.selectedProblemId = event.eventId || "";
  elements.detailPlaceholder.hidden = true;
  elements.detailContent.hidden = false;
  elements.detailPanel.classList.add("is-open");
  elements.detailDirection.textContent = `${directionLabels[event.direction] || event.direction} · ${formatTime(event.time, true)}`;
  elements.detailTitle.textContent = eventTitle(event);
  elements.copyProblemId.hidden = !state.selectedProblemId;
  elements.copyProblemId.textContent = "复制问题 ID";
  const entries = [
    ["问题 ID", event.eventId],
    ["记录 ID", event.id],
    ["事件类型", event.eventType],
    ["消息", event.messageId],
    ["飞书会话", event.chatId],
    ["飞书话题标识", event.larkThreadId],
    ["路由类型", routeTypeLabels[event.routeType] || event.routeType],
    ["已注入初始化提示词", event.initializationPromptInjected ? "是" : ""],
    ["新任务初始化状态", event.topicSetupStatus],
    ["初始化标识", event.topicSetupId],
    ["项目 Skill", event.skillName],
    ["Skill 版本", event.skillVersion],
    ["首次上下文消息数", event.initialContextMessageCount],
    ["首次上下文图片数", event.initialContextImageCount],
    ["首次上下文文件数", event.initialContextFileCount],
    ["首次上下文已截断", event.initialContextTruncated ? "是" : ""],
    ["Codex 任务", event.threadTitle],
    ["Codex 任务 ID", event.threadId],
    ["发送者", event.senderId],
    ["幂等键", event.idempotencyKey],
    ["文档", event.fileToken],
    ["评论", event.commentId],
    ["回复", event.replyId],
    ["排队耗时", Number.isFinite(event.queueWaitMs) ? `${event.queueWaitMs} ms` : ""],
    ["发送重试次数", event.deliveryRetryAttempts ?? event.retryAttempt],
    ["下次重试序号", event.nextRetryAttempt],
    ["重试等待", Number.isFinite(event.retryDelayMs) ? `${event.retryDelayMs} ms` : ""],
    ["发送重试耗时", Number.isFinite(event.deliveryRetryElapsedMs) ? `${event.deliveryRetryElapsedMs} ms` : ""],
    ["耗时", Number.isFinite(event.durationMs) ? `${event.durationMs} ms` : ""],
    ["原因", event.reason],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  elements.detailGrid.replaceChildren();
  for (const [label, value] of entries) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    elements.detailGrid.append(term, description);
  }
  elements.detailMessage.textContent = event.content || "（无正文）";
  const metadata = Object.fromEntries(
    Object.entries(event).filter(([key]) => !["content", "summary"].includes(key)),
  );
  elements.detailMetadata.textContent = JSON.stringify(metadata, null, 2);
  renderEvents();
}

elements.copyProblemId.addEventListener("click", async () => {
  if (!state.selectedProblemId) {
    return;
  }
  try {
    await navigator.clipboard.writeText(state.selectedProblemId);
    elements.copyProblemId.textContent = "已复制";
    setTimeout(() => {
      elements.copyProblemId.textContent = "复制问题 ID";
    }, 1600);
  } catch {
    elements.copyProblemId.textContent = "复制失败";
  }
});

function renderEvents() {
  const events = visibleEvents();
  elements.trafficBody.replaceChildren();
  for (const event of events) {
    const row = elements.rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.eventId = event.id;
    row.classList.toggle("is-selected", event.id === state.selectedId);
    row.querySelector(".time-cell").textContent = formatTime(event.time);
    const direction = row.querySelector(".direction-pill");
    direction.dataset.direction = event.direction;
    direction.textContent = directionLabels[event.direction] || event.direction;
    row.querySelector(".kind-cell").textContent = kindLabels[event.kind] || event.kind;
    row.querySelector(".stage-cell").textContent = stageLabels[event.stage] || event.stage;
    row.querySelector(".message-cell strong").textContent = eventTitle(event);
    row.querySelector(".message-cell span").textContent = truncate(event.content || event.reason || event.eventId || "无正文");
    row.querySelector(".thread-cell strong").textContent = event.threadTitle || "--";
    row.querySelector(".thread-cell span").textContent = event.threadId || "--";
    row.querySelector(".thread-cell").title = event.threadId || "";
    const status = row.querySelector(".status-pill");
    status.dataset.status = event.status;
    status.textContent = statusLabels[event.status] || event.status;
    const open = () => selectEvent(event);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (keyboardEvent) => {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        open();
      }
    });
    elements.trafficBody.append(row);
  }
  elements.emptyState.hidden = events.length !== 0;
  elements.resultSummary.textContent = `${events.length} 条记录`;
  elements.lastUpdated.textContent = `更新于 ${formatTime(new Date().toISOString())}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function refreshPendingOutbound() {
  const result = await fetchJson("/api/pending-outbound");
  state.pendingOutbound = result.messages || [];
  renderPendingOutbound();
}

async function refresh() {
  try {
    const [health, traffic, pending] = await Promise.all([
      fetchJson("/api/health"),
      fetchJson("/api/events?limit=1000"),
      fetchJson("/api/pending-outbound"),
    ]);
    renderHealth(health);
    state.events = traffic.events || [];
    state.pendingOutbound = pending.messages || [];
    renderPendingOutbound();
    renderEvents();
  } catch (error) {
    elements.connectionState.dataset.state = "error";
    elements.connectionText.textContent = "观察服务不可用";
    elements.lastUpdated.textContent = error.message;
  }
}

function connectLiveStream() {
  state.eventSource?.close();
  state.eventSource = null;
  if (!state.live) {
    return;
  }
  const source = new EventSource("/api/events/stream");
  state.eventSource = source;
  source.addEventListener("traffic", (message) => {
    const event = JSON.parse(message.data);
    state.events = [event, ...state.events.filter((item) => item.id !== event.id)].slice(0, 1000);
    renderEvents();
    void refreshPendingOutbound();
  });
  source.addEventListener("status", (message) => {
    renderHealth(JSON.parse(message.data));
  });
  source.onerror = () => {
    if (state.live) {
      elements.connectionState.dataset.state = "disconnected";
      elements.connectionText.textContent = "正在重连";
    }
  };
}

document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("click", () => {
    state.direction = button.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    renderEvents();
  });
});

elements.kindFilter.addEventListener("change", () => {
  state.kind = elements.kindFilter.value;
  renderEvents();
});

let searchTimer = null;
elements.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = elements.searchInput.value.trim();
    renderEvents();
  }, 120);
});

elements.liveToggle.addEventListener("change", () => {
  state.live = elements.liveToggle.checked;
  connectLiveStream();
});

elements.refreshButton.addEventListener("click", () => void refresh());
elements.closeDetail.addEventListener("click", () => {
  state.selectedId = null;
  elements.detailPanel.classList.remove("is-open");
  elements.detailPlaceholder.hidden = false;
  elements.detailContent.hidden = true;
  renderEvents();
});

await refresh();
connectLiveStream();
setInterval(() => {
  if (state.health) {
    renderHealth({
      ...state.health,
      uptimeMs: Date.now() - new Date(state.health.startedAt).getTime(),
    });
  }
}, 1000);
