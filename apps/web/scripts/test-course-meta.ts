/**
 * Test script for Phase A' course metadata resolution
 * Run: npx tsx scripts/test-course-meta.ts
 */
import 'dotenv/config';
import { getCourseMeta, resolveLocalized, clearCourseMetaCache } from '../src/lib/courses/course-meta';

async function testCourseMeta() {
  console.log('Testing Phase A\' course metadata resolution...\n');

  // Clear cache to ensure fresh loads
  clearCourseMetaCache();

  // Test 1: MI course should have specific values
  console.log('=== MI Colombia Curriculum ===');
  const mi = await getCourseMeta('mi-colombia-curriculum');

  console.log(`mentorName: ${mi.mentorName}`);
  console.log(`displayName: ${mi.displayName}`);
  console.log(`terminology.participant (en): ${resolveLocalized(mi.terminology.participant, 'en')}`);
  console.log(`terminology.participant (es): ${resolveLocalized(mi.terminology.participant, 'es')}`);
  console.log(`learnerContext defined: ${mi.learnerContext !== undefined}`);
  if (mi.learnerContext) {
    console.log(`  label (en): ${resolveLocalized(mi.learnerContext.label, 'en')}`);
    console.log(`  fields: ${mi.learnerContext.fields.map(f => f.key).join(', ')}`);
  }
  console.log(`onboarding.steps: ${mi.onboarding.steps.length}`);
  if (mi.onboarding.steps.length > 0) {
    console.log(`  step ids: ${mi.onboarding.steps.map(s => s.id).join(', ')}`);
  }
  console.log(`scheduledCheckins: ${mi.scheduledCheckins.length}`);
  if (mi.scheduledCheckins.length > 0) {
    console.log(`  checkin ids: ${mi.scheduledCheckins.map(c => `${c.id}(enabled=${c.enabled})`).join(', ')}`);
  }

  // Assertions for MI
  let errors: string[] = [];
  if (mi.mentorName !== 'Martín') errors.push(`MI mentorName expected 'Martín', got '${mi.mentorName}'`);
  if (resolveLocalized(mi.terminology.participant, 'en') !== 'partner') errors.push(`MI participant(en) expected 'partner'`);
  if (resolveLocalized(mi.terminology.participant, 'es') !== 'socio') errors.push(`MI participant(es) expected 'socio'`);
  if (!mi.learnerContext) errors.push('MI learnerContext expected to be defined');
  if (mi.scheduledCheckins.length === 0) errors.push('MI scheduledCheckins expected to have items');
  if (mi.scheduledCheckins[0]?.enabled !== true) errors.push('MI financial-weekly checkin expected to be enabled');

  console.log('');

  // Test 2: PBJ course should have pure defaults
  console.log('=== PBJ Basics ===');
  clearCourseMetaCache();
  const pbj = await getCourseMeta('pbj-basics');

  console.log(`mentorName: ${pbj.mentorName}`);
  console.log(`displayName: ${pbj.displayName}`);
  console.log(`terminology.participant (en): ${resolveLocalized(pbj.terminology.participant, 'en')}`);
  console.log(`learnerContext defined: ${pbj.learnerContext !== undefined}`);
  console.log(`onboarding.steps: ${pbj.onboarding.steps.length}`);
  console.log(`scheduledCheckins: ${pbj.scheduledCheckins.length}`);

  // Assertions for PBJ
  if (pbj.mentorName !== 'Chef') errors.push(`PBJ mentorName expected 'Chef', got '${pbj.mentorName}'`);
  if (resolveLocalized(pbj.terminology.participant, 'en') !== 'participant') errors.push(`PBJ participant(en) expected 'participant'`);
  if (pbj.learnerContext !== undefined) errors.push('PBJ learnerContext expected to be undefined');
  if (pbj.onboarding.steps.length !== 0) errors.push('PBJ onboarding.steps expected to be empty');
  if (pbj.scheduledCheckins.length !== 0) errors.push('PBJ scheduledCheckins expected to be empty');

  console.log('');

  // Test 3: Unknown course should have pure defaults
  console.log('=== Unknown Course ===');
  clearCourseMetaCache();
  const unknown = await getCourseMeta('nonexistent-course');

  console.log(`mentorName: ${unknown.mentorName}`);
  console.log(`terminology.participant (en): ${resolveLocalized(unknown.terminology.participant, 'en')}`);
  console.log(`learnerContext defined: ${unknown.learnerContext !== undefined}`);

  // Assertions for unknown
  if (unknown.mentorName !== 'Tutor') errors.push(`Unknown mentorName expected 'Tutor', got '${unknown.mentorName}'`);
  if (resolveLocalized(unknown.terminology.participant, 'en') !== 'participant') errors.push(`Unknown participant(en) expected 'participant'`);
  if (unknown.learnerContext !== undefined) errors.push('Unknown learnerContext expected to be undefined');

  console.log('');

  // Summary
  if (errors.length === 0) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Tests failed:');
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }
}

testCourseMeta().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});
