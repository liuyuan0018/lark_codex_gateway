const SETUP_STATUSES = new Set(["pending", "running", "completed", "failed"]);

export function buildTopicInitializationPrompt(route) {
  const sections = [];
  if (route.initializationPrompt) {
    sections.push(route.initializationPrompt);
  }
  if (route.skillName) {
    sections.push(`每轮使用 $${route.skillName} 处理当前话题，并遵守工作目录中的 AGENTS.md。`);
  }
  return sections.join("\n\n");
}

export function normalizePersistedTopicAssignment(assignment, persistedVersion) {
  const isCurrentState = persistedVersion >= 5;
  const setupStatus = isCurrentState && SETUP_STATUSES.has(assignment.setupStatus)
    ? assignment.setupStatus
    : "legacy";
  return {
    threadId: assignment.threadId,
    threadTitle: typeof assignment.threadTitle === "string" ? assignment.threadTitle : "",
    createdAt: typeof assignment.createdAt === "string" ? assignment.createdAt : "",
    initializedAt: typeof assignment.initializedAt === "string" ? assignment.initializedAt : "",
    initializationPending: setupStatus === "pending",
    setupStatus,
    setupId: isCurrentState && typeof assignment.setupId === "string" ? assignment.setupId : "",
    skillName: isCurrentState && typeof assignment.skillName === "string" ? assignment.skillName : "",
    skillVersion: isCurrentState && typeof assignment.skillVersion === "string" ? assignment.skillVersion : "",
    initialContextMessageCount: isCurrentState && Number.isSafeInteger(assignment.initialContextMessageCount)
      ? assignment.initialContextMessageCount
      : 0,
    initialContextImageCount: isCurrentState && Number.isSafeInteger(assignment.initialContextImageCount)
      ? assignment.initialContextImageCount
      : 0,
    initialContextFileCount: isCurrentState && Number.isSafeInteger(assignment.initialContextFileCount)
      ? assignment.initialContextFileCount
      : 0,
    initialContextTruncated: isCurrentState && assignment.initialContextTruncated === true,
  };
}

export function topicSetupShouldRun(assignment) {
  return assignment?.setupStatus === "pending";
}
