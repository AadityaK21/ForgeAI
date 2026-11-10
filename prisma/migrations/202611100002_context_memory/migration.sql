ALTER TABLE "User" ADD COLUMN "memoryEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentRun" ADD COLUMN "contextSnapshot" TEXT;
CREATE TABLE "PreferenceMemory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PreferenceMemory_ownerId_category_key" ON "PreferenceMemory"("ownerId", "category");
CREATE INDEX "PreferenceMemory_ownerId_expiresAt_idx" ON "PreferenceMemory"("ownerId", "expiresAt");
