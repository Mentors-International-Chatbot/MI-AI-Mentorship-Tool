# AI Mentoring Tool – Mentors International (100 Socio Pilot)

## 1. Project Overview
**One-Sentence Goal**: Design and pilot an AI-powered WhatsApp mentoring system that delivers Mentors International–aligned, personalized, 24/7 support to socios while reducing mentor workload and maintaining high socio satisfaction.

**Primary Users**:
- Socios (micro-entrepreneurs in Colombia)
- Regional mentors / managers at Mentors International

**Primary Interface**:
- WhatsApp (text only)

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
- Consent is explicitly confirmed in first AI interaction
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

**Behavioral Constraints**:
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
