-- Webhooks are signed with the shared infra key once each project has its own LiveKit
-- API key, so events are attributed to a project by room instead of by issuer.

CREATE TABLE "ProjectRoom" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRoom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectRoom_name_key" ON "ProjectRoom"("name");
CREATE INDEX "ProjectRoom_projectId_idx" ON "ProjectRoom"("projectId");

ALTER TABLE "ProjectRoom" ADD CONSTRAINT "ProjectRoom_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectRoomPrefix" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRoomPrefix_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectRoomPrefix_prefix_idx" ON "ProjectRoomPrefix"("prefix");
CREATE UNIQUE INDEX "ProjectRoomPrefix_projectId_prefix_key" ON "ProjectRoomPrefix"("projectId", "prefix");

ALTER TABLE "ProjectRoomPrefix" ADD CONSTRAINT "ProjectRoomPrefix_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
