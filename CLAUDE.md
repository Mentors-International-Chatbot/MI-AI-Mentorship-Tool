# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered WhatsApp mentoring system for Mentors International, delivering personalized 24/7 AI mentorship to micro-entrepreneurs (socios) in Colombia. Built with Next.js 16 (App Router), TypeScript, Prisma/SQLite, and LangChain.

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
```

## Architecture

**Request Flow:** WhatsApp → Meta Webhook (`/api/webhook/meta`) → Onboarding Service OR AI Service → WhatsApp Client → User

**Key Directories:**
- `apps/web/src/app/api/webhook/meta/route.ts` - Message orchestrator (webhook handler)
- `apps/web/src/lib/onboarding/service.ts` - Stateful onboarding flow (NEW → AWAITING_CONSENT → AWAITING_NAME → ACTIVE)
- `apps/web/src/lib/ai/service.ts` - LangChain AI generation with conversation context
- `apps/web/src/lib/whatsapp/client.ts` - Meta Graph API client
- `apps/web/src/lib/repo/` - Data layer (currently in-memory, Prisma ready)

**Data Persistence:** Currently uses in-memory Map for MVP. To switch to Prisma, change export in `src/lib/repo/index.ts`.

**Onboarding States:** `NEW` → `AWAITING_CONSENT` → `AWAITING_NAME` → `ACTIVE`. Consent step toggleable via `REQUIRE_LEGAL_CONSENT` flag.

## Key Patterns

- **Path alias:** Use `@/lib/*` imports
- **All user-facing text in Spanish** - maintain Colombian Spanish tone
- **AI context:** Last 10 messages passed to LLM for conversation continuity
- **Model:** GPT-4o-mini via LangChain (model-agnostic architecture)
- **Curriculum reference:** `/data/curriculum/mentors_manual_key_points.txt` contains 28 MI training modules

## Environment Variables

```
META_API_TOKEN          # Meta Graph API bearer token
META_PHONE_NUMBER_ID    # WhatsApp business phone ID
META_VERIFY_TOKEN       # Webhook verification token
OPENAI_API_KEY          # Required for AI responses
```

## Current Limitations (MVP)

- In-memory data lost on restart
- No mentor dashboard UI yet
- No authentication/role system
- System prompts hardcoded (not DB-driven)
