-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NEW', 'AWAITING_LANGUAGE', 'AWAITING_CONSENT', 'AWAITING_NAME', 'AWAITING_BUSINESS', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ProgramVersionStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ObservationSource" AS ENUM ('self_reported', 'human_recorded', 'system_observed', 'calculated', 'ai_inferred');

-- CreateEnum
CREATE TYPE "AssessmentSessionStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateTable
CREATE TABLE "system_prompts" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socios" (
    "id" TEXT NOT NULL,
    "whatsapp_phone_number" TEXT,
    "channel_type" TEXT NOT NULL DEFAULT 'whatsapp',
    "external_id" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'es',
    "password_hash" TEXT,
    "name" TEXT,
    "business_name" TEXT,
    "business_description" TEXT,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NEW',
    "prompt_overrides" JSONB,
    "ai_paused" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "mentor_id" TEXT,
    "curriculum_collection_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socio_feedback" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "lesson_num" INTEGER NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sender_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessment_session_id" TEXT,
    "metadata" JSONB,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socio_progress" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "current_lesson_number" INTEGER NOT NULL DEFAULT 1,
    "current_message_index" INTEGER NOT NULL DEFAULT 0,
    "completed_lessons" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "weekly_understanding" INTEGER,
    "weekly_implementation" INTEGER,
    "last_lesson_completed_at" TIMESTAMP(3),
    "reminders_sent" INTEGER NOT NULL DEFAULT 0,
    "last_interaction_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socio_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summaries" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "flags" JSONB,
    "metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socio_flags" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai_marker',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "lesson_number" INTEGER NOT NULL,
    "understanding" INTEGER,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_sentiments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "confusion" INTEGER NOT NULL,
    "frustration" INTEGER NOT NULL,
    "urgency" INTEGER NOT NULL,
    "sentiment" TEXT NOT NULL,
    "topics" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_sentiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socio_contexts" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "business_type" TEXT,
    "products" TEXT,
    "monthly_revenue" TEXT,
    "monthly_expenses" TEXT,
    "num_employees" TEXT,
    "location" TEXT,
    "challenges" TEXT,
    "goals" TEXT,
    "family_context" TEXT,
    "custom_facts" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_snapshots" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "net_profit" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai_marker',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socio_dimension_states" (
    "id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL,
    "level" DOUBLE PRECISION NOT NULL,
    "trend" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_dimension_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_versions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "ProgramVersionStatus" NOT NULL DEFAULT 'draft',
    "primary_lang" TEXT NOT NULL DEFAULT 'es',
    "collection_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "program_version_id" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "program_version_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_invitations" (
    "id" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "socio_id" TEXT,
    "display_name" TEXT,
    "preferred_lang" TEXT NOT NULL DEFAULT 'es',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentor_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "mentor_id" TEXT,
    "display_name" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentoring_relationships" (
    "id" TEXT NOT NULL,
    "mentor_profile_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentoring_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_collections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_lessons" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_versions" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'es',
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "scale" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_observations" (
    "id" TEXT NOT NULL,
    "metric_id" TEXT NOT NULL,
    "enrollment_id" TEXT,
    "signal_type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidence_refs" JSONB,
    "model_version" TEXT,
    "prompt_version" TEXT,
    "verification_status" TEXT,
    "source" "ObservationSource" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "metric_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "severity" TEXT NOT NULL,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "trigger_value" DOUBLE PRECISION NOT NULL,
    "message" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_reviews" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "socio_id" TEXT NOT NULL,
    "lesson_key" TEXT NOT NULL,
    "block_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'teach_back',
    "status" "AssessmentSessionStatus" NOT NULL DEFAULT 'pending',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "live_state" JSONB,
    "scores" JSONB,
    "passed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "config_snapshot" JSONB,
    "channel" TEXT NOT NULL DEFAULT 'web',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_prompts_category_active_idx" ON "system_prompts"("category", "active");

-- CreateIndex
CREATE INDEX "system_logs_category_created_at_idx" ON "system_logs"("category", "created_at");

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "socios_whatsapp_phone_number_key" ON "socios"("whatsapp_phone_number");

-- CreateIndex
CREATE INDEX "socios_mentor_id_status_idx" ON "socios"("mentor_id", "status");

-- CreateIndex
CREATE INDEX "socios_status_updated_at_idx" ON "socios"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "socios_channel_external_id_key" ON "socios"("channel_type", "external_id");

-- CreateIndex
CREATE INDEX "socio_feedback_socio_id_lesson_num_idx" ON "socio_feedback"("socio_id", "lesson_num");

-- CreateIndex
CREATE UNIQUE INDEX "mentors_email_key" ON "mentors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_email_expires_at_idx" ON "password_reset_tokens"("email", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "program_config_key_key" ON "program_config"("key");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "messages_assessment_session_id_created_at_idx" ON "messages"("assessment_session_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_socio_id_created_at_idx" ON "messages"("socio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "socio_progress_socio_id_key" ON "socio_progress"("socio_id");

-- CreateIndex
CREATE INDEX "summaries_socio_id_week_start_date_idx" ON "summaries"("socio_id", "week_start_date");

-- CreateIndex
CREATE INDEX "socio_flags_socio_id_resolved_idx" ON "socio_flags"("socio_id", "resolved");

-- CreateIndex
CREATE INDEX "socio_flags_resolved_level_created_at_idx" ON "socio_flags"("resolved", "level", "created_at");

-- CreateIndex
CREATE INDEX "lesson_progress_socio_id_completed_at_idx" ON "lesson_progress"("socio_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_socio_lesson_key" ON "lesson_progress"("socio_id", "lesson_number");

-- CreateIndex
CREATE UNIQUE INDEX "message_sentiments_message_id_key" ON "message_sentiments"("message_id");

-- CreateIndex
CREATE INDEX "message_sentiments_socio_id_created_at_idx" ON "message_sentiments"("socio_id", "created_at");

-- CreateIndex
CREATE INDEX "message_sentiments_sentiment_created_at_idx" ON "message_sentiments"("sentiment", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "socio_contexts_socio_id_key" ON "socio_contexts"("socio_id");

-- CreateIndex
CREATE INDEX "financial_snapshots_socio_id_week_start_date_idx" ON "financial_snapshots"("socio_id", "week_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_snapshot_socio_week_key" ON "financial_snapshots"("socio_id", "week_start_date");

-- CreateIndex
CREATE INDEX "socio_dimension_states_socio_id_idx" ON "socio_dimension_states"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "socio_dimension_state_unique" ON "socio_dimension_states"("socio_id", "dimension_key");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_memberships_organization_id_idx" ON "organization_memberships"("organization_id");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "programs_organization_id_idx" ON "programs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_organization_id_slug_key" ON "programs"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "program_versions_program_id_status_idx" ON "program_versions"("program_id", "status");

-- CreateIndex
CREATE INDEX "program_versions_program_id_active_idx" ON "program_versions"("program_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "program_versions_program_id_version_key" ON "program_versions"("program_id", "version");

-- CreateIndex
CREATE INDEX "cohorts_program_id_idx" ON "cohorts"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "cohorts_program_id_slug_key" ON "cohorts"("program_id", "slug");

-- CreateIndex
CREATE INDEX "enrollments_cohort_id_idx" ON "enrollments"("cohort_id");

-- CreateIndex
CREATE INDEX "enrollments_participant_id_idx" ON "enrollments"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_participant_id_cohort_id_key" ON "enrollments"("participant_id", "cohort_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_invitations_token_key" ON "enrollment_invitations"("token");

-- CreateIndex
CREATE INDEX "enrollment_invitations_cohort_id_idx" ON "enrollment_invitations"("cohort_id");

-- CreateIndex
CREATE INDEX "enrollment_invitations_token_idx" ON "enrollment_invitations"("token");

-- CreateIndex
CREATE UNIQUE INDEX "participant_profiles_socio_id_key" ON "participant_profiles"("socio_id");

-- CreateIndex
CREATE INDEX "participant_profiles_organization_id_idx" ON "participant_profiles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "mentor_profiles_mentor_id_key" ON "mentor_profiles"("mentor_id");

-- CreateIndex
CREATE INDEX "mentor_profiles_organization_id_idx" ON "mentor_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "mentoring_relationships_mentor_profile_id_idx" ON "mentoring_relationships"("mentor_profile_id");

-- CreateIndex
CREATE INDEX "mentoring_relationships_participant_id_idx" ON "mentoring_relationships"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mentoring_relationships_mentor_profile_id_participant_id_ro_key" ON "mentoring_relationships"("mentor_profile_id", "participant_id", "role");

-- CreateIndex
CREATE INDEX "content_collections_organization_id_idx" ON "content_collections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_collections_organization_id_slug_key" ON "content_collections"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "content_lessons_collection_id_order_index_idx" ON "content_lessons"("collection_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "content_lessons_collection_id_slug_key" ON "content_lessons"("collection_id", "slug");

-- CreateIndex
CREATE INDEX "lesson_versions_lesson_id_active_idx" ON "lesson_versions"("lesson_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_versions_lesson_id_version_lang_key" ON "lesson_versions"("lesson_id", "version", "lang");

-- CreateIndex
CREATE INDEX "metric_definitions_organization_id_idx" ON "metric_definitions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definitions_organization_id_key_key" ON "metric_definitions"("organization_id", "key");

-- CreateIndex
CREATE INDEX "metric_observations_metric_id_observed_at_idx" ON "metric_observations"("metric_id", "observed_at");

-- CreateIndex
CREATE INDEX "metric_observations_enrollment_id_observed_at_idx" ON "metric_observations"("enrollment_id", "observed_at");

-- CreateIndex
CREATE INDEX "alert_rules_organization_id_active_idx" ON "alert_rules"("organization_id", "active");

-- CreateIndex
CREATE INDEX "alert_rules_metric_id_idx" ON "alert_rules"("metric_id");

-- CreateIndex
CREATE INDEX "alerts_rule_id_created_at_idx" ON "alerts"("rule_id", "created_at");

-- CreateIndex
CREATE INDEX "alerts_enrollment_id_resolved_at_idx" ON "alerts"("enrollment_id", "resolved_at");

-- CreateIndex
CREATE INDEX "alert_reviews_alert_id_idx" ON "alert_reviews"("alert_id");

-- CreateIndex
CREATE INDEX "alert_reviews_reviewer_id_idx" ON "alert_reviews"("reviewer_id");

-- CreateIndex
CREATE INDEX "assessment_sessions_organization_id_idx" ON "assessment_sessions"("organization_id");

-- CreateIndex
CREATE INDEX "assessment_sessions_socio_id_status_idx" ON "assessment_sessions"("socio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_socio_id_lesson_key_attempt_number_key" ON "assessment_sessions"("socio_id", "lesson_key", "attempt_number");

-- AddForeignKey
ALTER TABLE "socios" ADD CONSTRAINT "socios_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_feedback" ADD CONSTRAINT "socio_feedback_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_assessment_session_id_fkey" FOREIGN KEY ("assessment_session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_progress" ADD CONSTRAINT "socio_progress_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_flags" ADD CONSTRAINT "socio_flags_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sentiments" ADD CONSTRAINT "message_sentiments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sentiments" ADD CONSTRAINT "message_sentiments_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_contexts" ADD CONSTRAINT "socio_contexts_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_dimension_states" ADD CONSTRAINT "socio_dimension_states_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "content_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "program_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_program_version_id_fkey" FOREIGN KEY ("program_version_id") REFERENCES "program_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_invitations" ADD CONSTRAINT "enrollment_invitations_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_profiles" ADD CONSTRAINT "mentor_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentor_profiles" ADD CONSTRAINT "mentor_profiles_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_relationships" ADD CONSTRAINT "mentoring_relationships_mentor_profile_id_fkey" FOREIGN KEY ("mentor_profile_id") REFERENCES "mentor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_relationships" ADD CONSTRAINT "mentoring_relationships_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_collections" ADD CONSTRAINT "content_collections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lessons_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "content_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "content_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_reviews" ADD CONSTRAINT "alert_reviews_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_reviews" ADD CONSTRAINT "alert_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "mentor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

