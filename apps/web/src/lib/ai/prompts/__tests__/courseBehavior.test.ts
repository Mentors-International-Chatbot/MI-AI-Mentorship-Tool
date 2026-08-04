import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseAiBehavior } from '@/lib/ai/prompts/courseBehavior';

const mockTenantRepo = { getActiveProgramVersionByCollection: vi.fn() };
vi.mock('@/lib/repo', () => ({ tenantRepo: mockTenantRepo }));

const { buildCourseBehaviorSnippet, resolveCourseAiBehavior, clearCourseBehaviorCache } =
  await import('@/lib/ai/prompts/courseBehavior');

const FULL: CourseAiBehavior = {
  tone: 'Supportive, patient',
  teachingStyle: 'Step-by-step with concrete examples',
  languageInstruction: "Respond in Colombian Spanish. Use informal 'tú' form.",
  primaryLang: 'es',
};

beforeEach(() => {
  vi.clearAllMocks();
  clearCourseBehaviorCache();
});

describe('buildCourseBehaviorSnippet', () => {
  it('includes tone and teaching style', () => {
    const out = buildCourseBehaviorSnippet(FULL, 'es');
    expect(out).toContain('Supportive, patient');
    expect(out).toContain('Step-by-step with concrete examples');
  });

  it('includes the language instruction when the learner reads the course language', () => {
    expect(buildCourseBehaviorSnippet(FULL, 'es')).toContain('Colombian Spanish');
  });

  it('omits the language instruction for a learner reading another language', () => {
    // The live case this exists for: MI's config says "Respond in Colombian
    // Spanish" and MI has 16 English learners. Injecting it would put a
    // course-level instruction in direct conflict with the learner-level
    // language directive, resolved by whichever the model weighted more.
    const out = buildCourseBehaviorSnippet(FULL, 'en');
    expect(out).not.toContain('Colombian Spanish');
    // Tone and teaching style describe HOW to teach, not in which language,
    // so they still apply.
    expect(out).toContain('Supportive, patient');
    expect(out).toContain('Step-by-step');
  });

  it('applies the language instruction for the other direction too', () => {
    const english: CourseAiBehavior = {
      languageInstruction: 'Respond in English.',
      primaryLang: 'en',
    };
    expect(buildCourseBehaviorSnippet(english, 'en')).toContain('Respond in English.');
    expect(buildCourseBehaviorSnippet(english, 'es')).toBe('');
  });

  it('localizes its heading and labels', () => {
    expect(buildCourseBehaviorSnippet(FULL, 'es')).toContain('ESTILO DE ESTE CURSO');
    expect(buildCourseBehaviorSnippet({ ...FULL, primaryLang: 'en' }, 'en')).toContain(
      'STYLE FOR THIS COURSE',
    );
    expect(buildCourseBehaviorSnippet({ ...FULL, primaryLang: 'pt' }, 'pt')).toContain(
      'ESTILO DESTE CURSO',
    );
  });

  it('returns nothing at all when there is no behavior', () => {
    // Must be '' and not a bare heading: an empty section is worse than none.
    expect(buildCourseBehaviorSnippet(null, 'es')).toBe('');
  });

  it('returns nothing when every field is absent', () => {
    expect(buildCourseBehaviorSnippet({ primaryLang: 'es' }, 'es')).toBe('');
  });

  it('returns nothing when only a mismatched language instruction exists', () => {
    expect(
      buildCourseBehaviorSnippet({ languageInstruction: 'Spanish', primaryLang: 'es' }, 'en'),
    ).toBe('');
  });
});

describe('resolveCourseAiBehavior', () => {
  it('refuses to read anything without a resolved organization', async () => {
    // resolvePromptScope drops the org when a slug is ambiguous across tenants.
    // Reading another tenant's behaviour config is worse than reading none.
    expect(await resolveCourseAiBehavior({ collectionKey: 'course-a' })).toBeNull();
    expect(mockTenantRepo.getActiveProgramVersionByCollection).not.toHaveBeenCalled();
  });

  it('returns null when the course has no published version', async () => {
    mockTenantRepo.getActiveProgramVersionByCollection.mockResolvedValue(null);
    expect(
      await resolveCourseAiBehavior({ organizationId: 'org', collectionKey: 'c' }),
    ).toBeNull();
  });

  it('returns null when the config carries no aiBehavior block', async () => {
    mockTenantRepo.getActiveProgramVersionByCollection.mockResolvedValue({
      config: {},
      primaryLang: 'es',
    });
    expect(
      await resolveCourseAiBehavior({ organizationId: 'org', collectionKey: 'c' }),
    ).toBeNull();
  });

  it('reads tone, style, instruction and primaryLang', async () => {
    mockTenantRepo.getActiveProgramVersionByCollection.mockResolvedValue({
      config: { aiBehavior: { tone: 'warm', teachingStyle: 'stepwise', languageInstruction: 'es-CO' } },
      primaryLang: 'es',
    });
    const r = await resolveCourseAiBehavior({ organizationId: 'org', collectionKey: 'c' });
    expect(r).toEqual({
      tone: 'warm',
      teachingStyle: 'stepwise',
      languageInstruction: 'es-CO',
      primaryLang: 'es',
    });
  });

  it('ignores non-string values rather than rendering them', async () => {
    // config is untyped JSON; a number here would otherwise reach the prompt.
    mockTenantRepo.getActiveProgramVersionByCollection.mockResolvedValue({
      config: { aiBehavior: { tone: 42, teachingStyle: null, languageInstruction: 'ok' } },
      primaryLang: 'en',
    });
    const r = await resolveCourseAiBehavior({ organizationId: 'org', collectionKey: 'c' });
    expect(r?.tone).toBeUndefined();
    expect(r?.teachingStyle).toBeUndefined();
    expect(r?.languageInstruction).toBe('ok');
  });

  it('does not take the conversation down when the lookup throws', async () => {
    mockTenantRepo.getActiveProgramVersionByCollection.mockRejectedValue(new Error('db down'));
    await expect(
      resolveCourseAiBehavior({ organizationId: 'org', collectionKey: 'c' }),
    ).resolves.toBeNull();
  });

  it('caches per course rather than querying every turn', async () => {
    mockTenantRepo.getActiveProgramVersionByCollection.mockResolvedValue({
      config: { aiBehavior: { tone: 'warm' } },
      primaryLang: 'es',
    });
    const scope = { organizationId: 'org', collectionKey: 'c' };
    await resolveCourseAiBehavior(scope);
    await resolveCourseAiBehavior(scope);
    expect(mockTenantRepo.getActiveProgramVersionByCollection).toHaveBeenCalledTimes(1);
  });
});
