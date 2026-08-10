ALTER TABLE "program_versions" ADD COLUMN "metadata" JSONB;

CREATE TABLE "block_progress" (
  "id" TEXT NOT NULL,
  "socio_id" TEXT NOT NULL,
  "collection_key" TEXT NOT NULL,
  "lesson_key" TEXT NOT NULL,
  "block_id" TEXT NOT NULL,
  "content_version" INTEGER NOT NULL DEFAULT 1,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "score" DOUBLE PRECISION,
  "response" JSONB,
  "state" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "block_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "block_progress_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "block_progress_identity_key" ON "block_progress"("socio_id", "collection_key", "lesson_key", "block_id");
CREATE INDEX "block_progress_socio_id_collection_key_completed_at_idx" ON "block_progress"("socio_id", "collection_key", "completed_at");

CREATE TABLE "diagnostic_attempts" (
  "id" TEXT NOT NULL,
  "socio_id" TEXT NOT NULL,
  "program_version_id" TEXT NOT NULL,
  "collection_key" TEXT NOT NULL,
  "answers" JSONB NOT NULL,
  "dimension_scores" JSONB NOT NULL,
  "overall_score" DOUBLE PRECISION NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "diagnostic_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "diagnostic_attempts_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "diagnostic_attempts_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "diagnostic_attempts_socio_id_collection_key_completed_at_idx" ON "diagnostic_attempts"("socio_id", "collection_key", "completed_at");
CREATE INDEX "diagnostic_attempts_program_version_id_idx" ON "diagnostic_attempts"("program_version_id");

CREATE TABLE "lti_platforms" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "issuer" TEXT NOT NULL,
  "client_id" TEXT NOT NULL, "authorization_url" TEXT NOT NULL, "token_url" TEXT NOT NULL,
  "jwks_url" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lti_platforms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_platforms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_platforms_issuer_client_id_key" ON "lti_platforms"("issuer", "client_id");
CREATE INDEX "lti_platforms_organization_id_idx" ON "lti_platforms"("organization_id");

CREATE TABLE "lti_deployments" (
  "id" TEXT NOT NULL, "platform_id" TEXT NOT NULL, "deployment_id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lti_deployments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_deployments_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "lti_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_deployments_platform_id_deployment_id_key" ON "lti_deployments"("platform_id", "deployment_id");

CREATE TABLE "lti_contexts" (
  "id" TEXT NOT NULL, "deployment_id" TEXT NOT NULL, "context_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL, "program_version_id" TEXT NOT NULL, "cohort_id" TEXT NOT NULL,
  "title" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lti_contexts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_contexts_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "lti_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lti_contexts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lti_contexts_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lti_contexts_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_contexts_deployment_id_context_id_key" ON "lti_contexts"("deployment_id", "context_id");
CREATE INDEX "lti_contexts_organization_id_idx" ON "lti_contexts"("organization_id");

CREATE TABLE "lti_identities" (
  "id" TEXT NOT NULL, "platform_id" TEXT NOT NULL, "subject" TEXT NOT NULL,
  "socio_id" TEXT, "mentor_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lti_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_identities_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "lti_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lti_identities_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "lti_identities_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_identities_platform_id_subject_key" ON "lti_identities"("platform_id", "subject");
CREATE INDEX "lti_identities_socio_id_idx" ON "lti_identities"("socio_id");
CREATE INDEX "lti_identities_mentor_id_idx" ON "lti_identities"("mentor_id");

CREATE TABLE "lti_enrollments" (
  "id" TEXT NOT NULL, "identity_id" TEXT NOT NULL, "context_id" TEXT NOT NULL, "role" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lti_enrollments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_enrollments_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "lti_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lti_enrollments_context_id_fkey" FOREIGN KEY ("context_id") REFERENCES "lti_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_enrollments_identity_id_context_id_role_key" ON "lti_enrollments"("identity_id", "context_id", "role");
CREATE INDEX "lti_enrollments_context_id_idx" ON "lti_enrollments"("context_id");

CREATE TABLE "lti_resource_links" (
  "id" TEXT NOT NULL, "context_id" TEXT NOT NULL, "resource_link_id" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL, "lesson_key" TEXT, "line_item_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lti_resource_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_resource_links_context_id_fkey" FOREIGN KEY ("context_id") REFERENCES "lti_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_resource_links_context_id_resource_link_id_key" ON "lti_resource_links"("context_id", "resource_link_id");

CREATE TABLE "lti_one_time_tokens" (
  "id" TEXT NOT NULL, "deployment_id" TEXT, "token_hash" TEXT NOT NULL, "purpose" TEXT NOT NULL,
  "target_link_uri" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lti_one_time_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_one_time_tokens_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "lti_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_one_time_tokens_token_hash_key" ON "lti_one_time_tokens"("token_hash");
CREATE INDEX "lti_one_time_tokens_purpose_expires_at_idx" ON "lti_one_time_tokens"("purpose", "expires_at");

CREATE TABLE "lti_sessions" (
  "id" TEXT NOT NULL, "token_hash" TEXT NOT NULL, "exchange_token_hash" TEXT NOT NULL,
  "identity_id" TEXT NOT NULL, "context_id" TEXT NOT NULL, "role" TEXT NOT NULL, "destination" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL, "exchanged_at" TIMESTAMP(3), "launch_data" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lti_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_sessions_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "lti_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lti_sessions_context_id_fkey" FOREIGN KEY ("context_id") REFERENCES "lti_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_sessions_token_hash_key" ON "lti_sessions"("token_hash");
CREATE UNIQUE INDEX "lti_sessions_exchange_token_hash_key" ON "lti_sessions"("exchange_token_hash");
CREATE INDEX "lti_sessions_expires_at_idx" ON "lti_sessions"("expires_at");

CREATE TABLE "lti_grade_deliveries" (
  "id" TEXT NOT NULL, "resource_link_id" TEXT NOT NULL, "socio_id" TEXT NOT NULL,
  "milestone_count" INTEGER NOT NULL, "score_given" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_error" TEXT, "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lti_grade_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lti_grade_deliveries_resource_link_id_fkey" FOREIGN KEY ("resource_link_id") REFERENCES "lti_resource_links"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lti_grade_deliveries_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lti_grade_deliveries_resource_link_id_socio_id_milestone_count_key" ON "lti_grade_deliveries"("resource_link_id", "socio_id", "milestone_count");
CREATE INDEX "lti_grade_deliveries_status_next_attempt_at_idx" ON "lti_grade_deliveries"("status", "next_attempt_at");
