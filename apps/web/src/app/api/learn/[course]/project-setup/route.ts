import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { TenantIsolationError } from "@/lib/repo/tenantContext";
import { LearnerProjectTransitionError } from "@/lib/repo/tenantPrismaRepo";
import { PlayerError, resolvePlayerAccess } from "@/lib/player/service";
import {
  confirmProjectSetup,
  getProjectSetupDto,
  LearnerProjectInputError,
  projectSetupConfirmSchema,
  projectSetupPostSchema,
  saveProjectSetupInterests,
  saveProjectSetupLifeContext,
  stageProjectSetup,
} from "@/lib/player/learnerProject";
import {
  finalizeProjectScope,
  generateProjectProposals,
  generateProjectScope,
  ProjectSelectionOutputError,
} from "@/lib/ai/project-selection/service";

function setupError(error: unknown, operation: string) {
  if (error instanceof PlayerError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  // Ordered before the ZodError branch: a bad model response is not a bad
  // request, and reporting it as one sent the last investigation to the wrong
  // half of the system. 502 says the upstream model failed, not the caller.
  if (error instanceof ProjectSelectionOutputError) {
    return NextResponse.json({
      error: "The project assistant returned an unusable response. Please try again.",
      code: "invalid_model_output",
      phase: error.phase,
      issues: error.issues,
    }, { status: 502 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid project setup request", code: "invalid_project_setup", issues: error.issues }, { status: 400 });
  }
  if (error instanceof LearnerProjectInputError) {
    const status = error.code === "project_selection_not_configured" ? 404 : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof LearnerProjectTransitionError) {
    return NextResponse.json({ error: error.message, code: "invalid_project_status_transition" }, { status: 409 });
  }
  if (error instanceof TenantIsolationError) {
    return NextResponse.json({ error: "Project setup access denied", code: "project_access_denied" }, { status: 403 });
  }
  console.error(`Project setup ${operation} failed`, error);
  return NextResponse.json({ error: `Unable to ${operation} project setup` }, { status: 500 });
}

async function accessFor(req: NextRequest, course: string) {
  const identity = await resolveRequestIdentity(req);
  if (!identity) return null;
  return resolvePlayerAccess(identity, course);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const access = await accessFor(req, (await params).course);
    if (!access) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(await getProjectSetupDto(access));
  } catch (error) {
    return setupError(error, "load");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const access = await accessFor(req, (await params).course);
    if (!access) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = projectSetupPostSchema.parse(await req.json().catch(() => ({})));
    if (body.action === "select_interests") {
      return NextResponse.json({ project: await saveProjectSetupInterests(access, body.interests) });
    }
    if (body.action === "proposals") {
      const project = await saveProjectSetupLifeContext(access, body.lifeContext);
      return NextResponse.json(await generateProjectProposals({
        access,
        lifeContext: body.lifeContext,
        interests: project.interests,
      }));
    }
    const setup = await getProjectSetupDto(access);
    if (!setup.project || setup.project.status !== "DRAFT" || !setup.project.lifeContext) {
      throw new LearnerProjectInputError("project_setup_not_ready", "Complete the interest picker and life-context turn first");
    }
    if (body.action === "scope") {
      return NextResponse.json(await generateProjectScope({
        access,
        lifeContext: setup.project.lifeContext,
        presetKey: body.presetKey,
      }));
    }
    const result = await finalizeProjectScope({
      access,
      lifeContext: setup.project.lifeContext,
      presetKey: body.presetKey,
      scopeResponse: body.scopeResponse,
    });
    const project = await stageProjectSetup(access, {
      presetKey: result.presetKey,
      oneLiner: result.oneLiner,
      context: result.context,
      automationLevel: result.automationLevel,
      reframed: result.reframed || result.presetKey !== body.presetKey,
    });
    return NextResponse.json({ ...result, project });
  } catch (error) {
    return setupError(error, "continue");
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const access = await accessFor(req, (await params).course);
    if (!access) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = projectSetupConfirmSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json({ project: await confirmProjectSetup(access, body.title) });
  } catch (error) {
    return setupError(error, "confirm");
  }
}
