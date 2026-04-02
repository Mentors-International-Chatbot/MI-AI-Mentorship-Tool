# AI Mentoring Tool – Master Project Plan

This document consolidates the Project Charter, Task List, and Technical Implementation Plan for the Mentors International AI Pilot.

---

# Part 1: Project Charter

## 1. Project Overview
**One-Sentence Goal** Design and pilot an AI-powered WhatsApp mentoring system that delivers Mentors International–aligned, personalized, 24/7 support to socios while reducing mentor workload and maintaining high socio satisfaction.

**Primary Users**:
- Socios (micro-entrepreneurs in Colombia)
- Regional mentors / managers at Mentors International
- Administrators (System configuration and Model management)

**Primary Interface**:
- WhatsApp (text only)
- Web Dashboard (Mentors & Admins)

## 2. Success Definition
**Primary Success Metrics**:
- High socio satisfaction (qualitative feedback)
- Reduced mentor time per socio
- Mentor trust in AI-generated summaries and recommendations

**Secondary Signals**:
- Sustained socio engagement
- Clear red/green flags surfaced
- Smooth human intervention when needed

**Explicit Non-Goals (Pilot)**:
- Full analytics dashboard
- Bancolombia reporting
- Voice or multimedia
- Advanced financial diagnostics
- Predictive risk scoring

## 3. Core Assumptions
- Socios enter via Bancolombia with name + WhatsApp number
- WhatsApp number is the primary identity
- Internal MI Socio ID will be created
- Consent is explicitly confirmed in first AI interaction (Toggleable by Admin)
- Spanish only
- Text only
- Self-reported business data is acceptable
- Human mentors remain available for escalation

## 4. Constraints & Guardrails
**Content Constraints (Hard Rules)**:
- AI must align with Mentors International curriculum
- No legal advice
- No tax advice
- No recommending loans
- No guessing when uncertain

**Behavioral Constraints (Configurable)**:
- Supportive, teacher-mentor tone
- Gentle guidance
- Simplified language
- Action-first responses
- Family- and context-aware

**Escalation Rules**:
- AI flags concerns but continues engagement
- Human mentors may inject into conversation
- AI announces live mentor handoff
- Mentors see summaries only, not raw transcripts

## 5. Pilot Scope
- **Size**: 100 socios
- **Duration**: 4–8 weeks of active interaction
- **Geography**: Colombia
- **Languages**: Spanish only

## 6. High-Level System Flow (Conceptual)
1. Socio signs up with Bancolombia
2. MI receives name + WhatsApp number
3. MI creates Socio ID
4. Socio receives WhatsApp onboarding message
5. AI confirms consent
6. AI learns socio context (business, challenges)
7. Ongoing AI mentorship over WhatsApp
8. Weekly AI summary generated
9. Mentor reviews summary in dashboard
10. Human mentor intervenes if needed

## 7. Phased Planning Roadmap
**(Please refer to task.md for active tracking of these phases)**

### Phase 0 – Alignment & Design
- Lock scope, language, tone, and boundaries
- Outputs: Agreed success metrics, AI behavior principles, Escalation philosophy, Non-goal list

### Phase 1 – Onboarding & Identity
- Ensure clean socio entry and consent
- Outputs: Onboarding flow, Consent confirmation script, Manual number transfer protocol

### Phase 2 – AI Mentorship Experience
- Define what the AI does and does not do
- Outputs: AI interaction principles, Example conversation flows, Inactivity check-in policy

### Phase 3 – Data & Metrics Collection
- Decide what data matters now
- Outputs: Weekly data capture plan, Self-report acceptance rules

### Phase 4 – Weekly Summary & Flagging
- Enable mentor oversight without overload
- Outputs: Weekly summary template, Flag definitions

### Phase 5 – Mentor Dashboard (Concept Only)
- Plan mentor interaction with AI outputs
- Outputs: Dashboard feature list, Mentor workflow map

### Phase 6 – Pilot Evaluation Plan
- Decide how success will be judged
- Outputs: Pilot evaluation rubric, Go / no-go criteria

## 9. Key Risks & Mitigations
- **Risk**: AI gives misaligned advice. **Mitigation**: Strict curriculum grounding + humility rules.
- **Risk**: Mentors don’t trust summaries. **Mitigation**: Keep summaries short, actionable, and conservative.
- **Risk**: Over-engineering too early. **Mitigation**: Pilot non-goals explicitly enforced.

---

# Part 2: Task List

## Phase 0: Alignment & Design
- [/] Define precise Success Metrics and KPIs
- [ ] Configurable AI Behavior Guidelines (Tone, Persona, Constraints)
- [ ] Define Escalation Philosophy and triggers
- [ ] detailed Technical Architecture Design

## Phase 1: Onboarding & Identity
- [ ] Design Data Model (Socio, Interaction, Summary)
- [ ] Design Onboarding Conversation Flow
- [ ] Design Toggleable Legal Consent Flow (Admin Configurable)
- [ ] Define "Socio ID" generation and mapping logic

## Phase 2: AI Mentorship Experience
- [ ] Setup LangChain Architecture (Model Agnostic)
- [ ] Design System Prompt Database Schema (Versioning/A/B Testing)
- [ ] Design Inactivity Check-in Logic (7-day trigger)
- [ ] Prototype "Context/Memory" storage (Conversation history management)

## Phase 3: Data & Metrics Collection
- [ ] Define key data points to extract from conversations (Revenue, Expenses, etc.)
- [ ] Design structured output format for conversation analysis

## Phase 4: Weekly Summary & Flagging
- [ ] Design Weekly Summary Template for Mentors
- [ ] Define Red/Yellow/Green flag logic

## Phase 5: Mentor Dashboard (MVP)
- [ ] Setup Web App Boilerplate (Next.js)
- [ ] Implement Mentor Dashboard View (List of Socios, Flags, Summaries)
- [ ] Implement "Socio Detail" View with "Prompt Influence" controls
- [ ] Implement Administrator Dashboard (System Prompts, Model Config)

## Technical Setup (Foundations)
- [ ] Initialize Git Repository (Next.js Monorepo)
- [ ] Setup Vercel Project & PostgreSQL
- [ ] Setup Prisma ORM & Schema
- [ ] Setup Meta Business App (WhatsApp API)

---

# Part 3: Technical Implementation Plan

## Goal Description
Build a scalable framework for the AI Mentoring Tool pilot. The system must handle incoming WhatsApp messages, process them via an LLM with specific context and guardrails, store conversation history, and generate weekly summaries for human mentors.

## User Review Required
> [!IMPORTANT]
> **Tech Stack Selection**:
> - **Backend**: TypeScript (Next.js Server Actions / API Routes).
> - **Database**: PostgreSQL (Vercel Postgres) + Prisma (ORM & Migrations).
> - **WhatsApp Provider**: Meta Business Cloud API (Direct).
> - **LLM Provider**: Model Agnostic via LangChain (Support for OpenAI, Anthropic, etc.).
> - **Dashboard**: Next.js (React) + Tailwind CSS + Vercel Deployment.

## Proposed Changes

### 1. Project Structure
Create a monorepo-style structure or separate folders for backend and frontend.
```
/
  apps/
    web/            # Next.js App (Dashboard + API)
      app/
        api/        # Webhooks & Internal API
        dashboard/  # Mentor & Admin UI
      lib/          # Shared Logic
        ai/         # LangChain Setup
        db/         # Prisma Client
        whatsapp/   # Meta API Client
      prisma/       # Schema & Migrations

  docs/             # Documentation
```

### 2. Backend (Next.js / TypeScript)
#### Core Components
- **Webhook Endpoint**: `/api/webhook/meta` to receive WhatsApp Business API events.
- **Message Orchestrator**:
    - Validates sender.
    - Fetches conversation history.
    - **Prompt Assembly**: Fetches active 'System Prompt' version from DB + applying Mentor-specific "Prompt Influence" settings.
    - **LangChain Pipeline**: Calls configured LLM (Admin controlled).
    - Sends response via `Meta Graph API`.
- **Scheduler**: Vercel Cron or Inngest for:
    - Weekly summary generation.
    - Inactivity checks (7 days).

### 3. Database Schema (Preliminary)
- **SystemPrompt**: `id`, `version`, `content`, `category` (e.g., 'onboarding', 'mentor_support'), `active` (boolean), `author_id`, `created_at`.
- **Socio**: `id`, `whatsapp_phone_number`, `name`, `prompt_overrides` (JSON - mentor influence), `metadata` (JSON).
- **Mentor**: `id`, `name`, `email`, `role` (mentor, admin).
- **Message**: `id`, `socio_id`, `role` (user/assistant/system), `content`, `timestamp`.
- **Summary**: `id`, `socio_id`, `week_start_date`, `content` (Markdown), `flags` (JSON), `metrics` (JSON).

### 4. AI & Prompts
- **Dynamic System Prompts**: Stored in DB. Admins can update/version prompts without code changes.
- **Model Agnostic**: LangChain wrapper to easily switch between GPT-4o, Claude 3.5, or cheaper models.
- **Prompt Influence**: Mentors can set limited parameters (e.g., "Language Complexity", "Tone Shift") for specific Socios via Dashboard.

### 5. Frontend (Mentor Dashboard)
- **Roles**: 
    - **Mentor**: View Socios, Summaries, Flags, and adjust "Prompt Influence" settings.
    - **Administrator**: Manage System Prompts (Versioning), Configure LLM Models, Global Settings (e.g., Toggle Legal Consent).
- **Socio List**: Filterable by flags.
- **Socio Detail**: View profile, summaries, conversation, and *Prompt Configuration*.

## Verification Plan

### Automated Tests
- **Unit Tests**: Test prompt construction and logic.
- **Integration Tests**: Simulate Twilio webhooks and verify database state.

### Manual Verification
- **Meta Sandbox**: Register test numbers in Meta Business Manager.
- **Admin Dashboard**: Create a new System Prompt version and verify the bot behavior changes immediately.
