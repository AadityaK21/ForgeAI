CREATE TABLE "Conversation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "ownerId" TEXT NOT NULL,
 "title" TEXT NOT NULL DEFAULT 'New chat',
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 "lease" TEXT,
 "leaseUntil" DATETIME,
 CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Conversation_ownerId_updatedAt_idx" ON "Conversation"("ownerId", "updatedAt");
CREATE TABLE "ChatMessage" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "conversationId" TEXT NOT NULL,
 "role" TEXT NOT NULL,
 "content" TEXT NOT NULL DEFAULT '',
 "status" TEXT NOT NULL DEFAULT 'complete',
 "error" TEXT,
 "model" TEXT,
 "requestId" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatMessage_conversationId_requestId_key" ON "ChatMessage"("conversationId", "requestId");
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");
