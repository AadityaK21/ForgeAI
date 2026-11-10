ALTER TABLE "Conversation" ADD COLUMN "agentMode" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "model" TEXT NOT NULL,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "cost" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AgentStep" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "input" TEXT NOT NULL,
  "preview" TEXT NOT NULL,
  "failed" BOOLEAN NOT NULL DEFAULT false,
  "sources" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AgentOutput" (
  "stepId" TEXT NOT NULL PRIMARY KEY,
  "content" TEXT NOT NULL,
  FOREIGN KEY ("stepId") REFERENCES "AgentStep"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentRun_messageId_createdAt_idx" ON "AgentRun"("messageId", "createdAt");
CREATE INDEX "AgentStep_runId_createdAt_idx" ON "AgentStep"("runId", "createdAt");
