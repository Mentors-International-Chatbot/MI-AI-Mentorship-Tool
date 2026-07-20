# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered WhatsApp mentoring system for Mentors International, delivering personalized 24/7 AI mentorship to micro-entrepreneurs (socios) in Colombia. Built with Next.js 16 (App Router), TypeScript, Prisma/PostgreSQL, and LangChain.

## Commands

```bash
# Development (from apps/web directory)
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run lint         # ESLint

# Testing webhook locally
./scripts/simulate-webhook.sh

# Database
npx prisma migrate dev    # Run migrations
npx prisma studio         # Open Prisma GUI
npx prisma generate       # Regenerate Prisma client after schema changes
```

## Architecture

**Request Flow:** WhatsApp → Meta Webhook (`/api/webhook/meta`) → Onboarding Service OR AI Service → WhatsApp Client → User

**Key Directories:**
- `apps/web/src/app/api/webhook/meta/route.ts` - Message orchestrator (webhook handler)
- `apps/web/src/lib/onboarding/service.ts` - Stateful onboarding flow (NEW → AWAITING_CONSENT → AWAITING_NAME → ACTIVE)
- `apps/web/src/lib/ai/service.ts` - LangChain AI generation with conversation context
- `apps/web/src/lib/whatsapp/client.ts` - Meta Graph API client
- `apps/web/src/lib/repo/` - Data layer (Prisma-backed, with Repo interface pattern)
- `apps/web/src/lib/db.ts` - Prisma client singleton

**Data Persistence:** PostgreSQL via Neon (hosted). Prisma ORM with Repo interface pattern (`src/lib/repo/types.ts`). To swap implementations, change export in `src/lib/repo/index.ts`.

**Onboarding States:** `NEW` → `AWAITING_CONSENT` → `AWAITING_NAME` → `ACTIVE`. Consent step toggleable via `REQUIRE_LEGAL_CONSENT` flag.

## Key Patterns

- **Path alias:** Use `@/lib/*` imports
- **All user-facing text in Spanish** - maintain Colombian Spanish tone
- **AI context:** Last 10 messages passed to LLM for conversation continuity
- **Model:** OpenRouter via LangChain (`OPENROUTER_MODEL`, defaults to Claude Haiku)
- **Curriculum reference:** `/data/curriculum/mentors_manual_key_points.txt` contains 28 MI training modules

## Environment Variables

```
DATABASE_URL            # PostgreSQL connection string (Neon)
META_API_TOKEN          # Meta Graph API bearer token
META_PHONE_NUMBER_ID    # WhatsApp business phone ID
META_VERIFY_TOKEN       # Webhook verification token
META_APP_SECRET         # App Secret — required in production for WhatsApp webhook HMAC (X-Hub-Signature-256)
OPENROUTER_API_KEY      # Required for AI responses
OPENROUTER_MODEL        # Optional (default: anthropic/claude-3.5-haiku)
```

## Current State

- **Auth:** bcryptjs + jose JWT with httpOnly cookies. Role-based middleware (socio → /chat, mentor/admin → /dashboard, admin → /admin).
- **Mentor Dashboard:** Live — socios list with health indicators, socio detail with summaries, flags, direct messaging, AI overrides.
- **Admin Dashboard:** Live — system prompts (versioned, DB-backed task layers via `loadActivePrompt`), program config, mentor management, system logs.
- **Curriculum:** 28 lessons defined in `apps/web/src/lib/lessons/data.ts`; MI reference in `/data/curriculum/mentors_manual_key_points.txt`.
- **Channels:** WhatsApp (Meta Business API) + Web chat.

## Known Limitations

- WhatsApp webhook signature verification runs when `META_APP_SECRET` is set; omit only for local/dev (requests are rejected without a valid signature when set).
- `/api/chat` uses a simple in-memory per-user rate limit (resets on deploy); swap for Redis or Vercel KV if you scale.
- Test AI endpoints (`/api/test-ai`, `/api/admin/prompts/test`) are restricted to mentor/admin; keep `CRON_SECRET` on cron routes.
