/**
 * Phase 1 Backfill Script
 *
 * Migrates existing Mentors International data into the new generalized domain model.
 * Uses upsert on stable natural keys so it can be re-run safely.
 *
 * Run: npx tsx scripts/backfill-phase1.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── Constants ───────────────────────────────────────────────────────────────

const MI_ORG_SLUG = 'mentors-international';
const MI_PROGRAM_SLUG = 'colombia-pilot';
const MI_COHORT_SLUG = '2026-q1';

async function main() {
  console.log('Phase 1 Backfill: Starting...\n');

  // ── 1. Upsert Mentors International Organization ──────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: MI_ORG_SLUG },
    update: {
      name: 'Mentors International',
      settings: {
        terminology: {
          participant: 'socio',
          participants: 'socios',
          mentor: 'mentor',
          mentors: 'mentores',
        },
        defaultLang: 'es',
        region: 'CO',
      },
    },
    create: {
      slug: MI_ORG_SLUG,
      name: 'Mentors International',
      settings: {
        terminology: {
          participant: 'socio',
          participants: 'socios',
          mentor: 'mentor',
          mentors: 'mentores',
        },
        defaultLang: 'es',
        region: 'CO',
      },
    },
  });
  console.log(`✓ Organization: ${org.name} (${org.id})`);

  // ── 2. Upsert Colombia Pilot Program ──────────────────────────────────────
  const program = await prisma.program.upsert({
    where: {
      organizationId_slug: {
        organizationId: org.id,
        slug: MI_PROGRAM_SLUG,
      },
    },
    update: {
      name: 'Colombia Pilot Program',
      description: 'AI-powered WhatsApp mentoring for micro-entrepreneurs in Colombia',
    },
    create: {
      organizationId: org.id,
      slug: MI_PROGRAM_SLUG,
      name: 'Colombia Pilot Program',
      description: 'AI-powered WhatsApp mentoring for micro-entrepreneurs in Colombia',
    },
  });
  console.log(`✓ Program: ${program.name} (${program.id})`);

  // ── 3. Upsert ProgramVersion v1 ───────────────────────────────────────────
  // Minimal stub config - Phase 3 fills this in properly from journey-package
  const programVersion = await prisma.programVersion.upsert({
    where: {
      programId_version: {
        programId: program.id,
        version: '1.0',
      },
    },
    update: {
      active: true,
      config: {
        schemaVersion: '1.0',
        aiBehavior: {
          tone: 'warm, encouraging',
          teachingStyle: 'conversational with practical examples',
          languageInstruction: 'Colombian Spanish, simple vocabulary',
        },
        // Placeholder - Phase 3 populates from journey-package
      },
    },
    create: {
      programId: program.id,
      version: '1.0',
      active: true,
      publishedAt: new Date(),
      config: {
        schemaVersion: '1.0',
        aiBehavior: {
          tone: 'warm, encouraging',
          teachingStyle: 'conversational with practical examples',
          languageInstruction: 'Colombian Spanish, simple vocabulary',
        },
      },
    },
  });
  console.log(`✓ ProgramVersion: v${programVersion.version} (${programVersion.id})`);

  // ── 4. Upsert Current Cohort ──────────────────────────────────────────────
  const cohort = await prisma.cohort.upsert({
    where: {
      programId_slug: {
        programId: program.id,
        slug: MI_COHORT_SLUG,
      },
    },
    update: {
      name: '2026 Q1 Cohort',
      programVersionId: programVersion.id,
      startsAt: new Date('2026-01-15'),
    },
    create: {
      programId: program.id,
      programVersionId: programVersion.id,
      slug: MI_COHORT_SLUG,
      name: '2026 Q1 Cohort',
      startsAt: new Date('2026-01-15'),
    },
  });
  console.log(`✓ Cohort: ${cohort.name} (${cohort.id})`);

  // ── 5. Migrate Socios → ParticipantProfile + Enrollment ───────────────────
  const socios = await prisma.socio.findMany({
    where: { status: 'ACTIVE' },
    include: { mentor: true },
  });

  let participantsCreated = 0;
  let participantsUpdated = 0;
  let enrollmentsCreated = 0;

  for (const socio of socios) {
    // Upsert ParticipantProfile linked to legacy Socio
    const participant = await prisma.participantProfile.upsert({
      where: { socioId: socio.id },
      update: {
        displayName: socio.name,
        preferredLang: socio.language,
        metadata: {
          legacyChannel: socio.channelType,
          legacyExternalId: socio.externalId,
          businessName: socio.businessName,
        },
      },
      create: {
        organizationId: org.id,
        socioId: socio.id,
        displayName: socio.name,
        preferredLang: socio.language,
        metadata: {
          legacyChannel: socio.channelType,
          legacyExternalId: socio.externalId,
          businessName: socio.businessName,
        },
      },
    });

    // Check if this was an update or create
    const existingParticipant = await prisma.participantProfile.findUnique({
      where: { socioId: socio.id },
    });
    if (existingParticipant && existingParticipant.createdAt < participant.updatedAt) {
      participantsUpdated++;
    } else {
      participantsCreated++;
    }

    // Upsert Enrollment (one per participant-cohort pair)
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        participantId_cohortId: {
          participantId: participant.id,
          cohortId: cohort.id,
        },
      },
    });

    if (!existingEnrollment) {
      await prisma.enrollment.create({
        data: {
          participantId: participant.id,
          cohortId: cohort.id,
          programVersionId: programVersion.id,
          status: 'active',
          enrolledAt: socio.createdAt,
        },
      });
      enrollmentsCreated++;
    }
  }

  console.log(`✓ ParticipantProfiles: ${participantsCreated} created, ${participantsUpdated} updated`);
  console.log(`✓ Enrollments: ${enrollmentsCreated} created`);

  // ── 6. Migrate Mentors → MentorProfile + MentoringRelationship ────────────
  const mentors = await prisma.mentor.findMany({
    include: { socios: true },
  });

  let mentorProfilesCreated = 0;
  let mentorProfilesUpdated = 0;
  let relationshipsCreated = 0;

  for (const mentor of mentors) {
    // Upsert MentorProfile linked to legacy Mentor
    const mentorProfile = await prisma.mentorProfile.upsert({
      where: { mentorId: mentor.id },
      update: {
        displayName: mentor.name,
        metadata: {
          email: mentor.email,
          legacyRole: mentor.role,
        },
      },
      create: {
        organizationId: org.id,
        mentorId: mentor.id,
        displayName: mentor.name,
        metadata: {
          email: mentor.email,
          legacyRole: mentor.role,
        },
      },
    });

    const existingProfile = await prisma.mentorProfile.findUnique({
      where: { mentorId: mentor.id },
    });
    if (existingProfile && existingProfile.createdAt < mentorProfile.updatedAt) {
      mentorProfilesUpdated++;
    } else {
      mentorProfilesCreated++;
    }

    // Create MentoringRelationship for each assigned socio
    for (const socio of mentor.socios) {
      // Find the participant profile for this socio
      const participant = await prisma.participantProfile.findUnique({
        where: { socioId: socio.id },
      });

      if (participant) {
        // Check if relationship already exists
        const existingRelationship = await prisma.mentoringRelationship.findUnique({
          where: {
            mentorId_participantId_role: {
              mentorId: mentorProfile.id,
              participantId: participant.id,
              role: 'primary',
            },
          },
        });

        if (!existingRelationship) {
          await prisma.mentoringRelationship.create({
            data: {
              mentorId: mentorProfile.id,
              participantId: participant.id,
              role: 'primary',
              activeFrom: socio.createdAt,
            },
          });
          relationshipsCreated++;
        }
      }
    }
  }

  console.log(`✓ MentorProfiles: ${mentorProfilesCreated} created, ${mentorProfilesUpdated} updated`);
  console.log(`✓ MentoringRelationships: ${relationshipsCreated} created`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────');
  console.log('Phase 1 Backfill: Complete');
  console.log('─────────────────────────────────────────────────');

  const counts = {
    organizations: await prisma.organization.count(),
    programs: await prisma.program.count(),
    programVersions: await prisma.programVersion.count(),
    cohorts: await prisma.cohort.count(),
    participantProfiles: await prisma.participantProfile.count(),
    mentorProfiles: await prisma.mentorProfile.count(),
    enrollments: await prisma.enrollment.count(),
    mentoringRelationships: await prisma.mentoringRelationship.count(),
  };

  console.log('Final counts:');
  for (const [model, count] of Object.entries(counts)) {
    console.log(`  ${model}: ${count}`);
  }
}

main()
  .catch((e) => {
    console.error('Backfill error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
