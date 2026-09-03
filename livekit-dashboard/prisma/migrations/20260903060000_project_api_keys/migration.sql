-- Extra key pairs per project. The pair on Project itself stays the primary that
-- LumiVoice uses for its own LiveKit calls; these are issued for the project's apps.

CREATE TABLE "ProjectApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectApiKey_apiKey_key" ON "ProjectApiKey"("apiKey");
CREATE INDEX "ProjectApiKey_projectId_idx" ON "ProjectApiKey"("projectId");

ALTER TABLE "ProjectApiKey" ADD CONSTRAINT "ProjectApiKey_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
