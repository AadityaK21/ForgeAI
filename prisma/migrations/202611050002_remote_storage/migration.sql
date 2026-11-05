-- CreateTable
CREATE TABLE "PreviewAsset" (
    "projectId" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "html" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "sandboxId"),
    CONSTRAINT "PreviewAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionState" (
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "name"),
    CONSTRAINT "CollectionState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectRecord" (
    "projectId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("projectId", "collection", "id"),
    CONSTRAINT "ProjectRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectRecord_projectId_collection_createdAt_idx" ON "ProjectRecord"("projectId", "collection", "createdAt");
