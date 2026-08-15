import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveRequestIdentity } from "@/lib/auth/requestIdentity";
import { TenantIsolationError } from "@/lib/repo/tenantContext";
import { LearnerProjectTransitionError } from "@/lib/repo/tenantPrismaRepo";
import {
  getCurrentLearnerProject,
  LearnerProjectInputError,
  learnerProjectPutSchema,
  putCurrentLearnerProject,
} from "@/lib/player/learnerProject";
import { PlayerError, resolvePlayerAccess } from "@/lib/player/service";

function projectError(error: unknown, operation: "load" | "save") {
  if (error instanceof PlayerError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid learner project", code: "invalid_project", issues: error.issues }, { status: 400 });
  }
  if (error instanceof LearnerProjectInputError) {
    const status = error.code === "project_selection_not_configured" ? 404 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof LearnerProjectTransitionError) {
    return NextResponse.json({ error: error.message, code: "invalid_project_status_transition" }, { status: 409 });
  }
  if (error instanceof TenantIsolationError) {
    return NextResponse.json({ error: "Project access denied", code: "project_access_denied" }, { status: 403 });
  }
  console.error(`Learner project ${operation} failed`, error);
  return NextResponse.json({ error: `Unable to ${operation} learner project` }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const access = await resolvePlayerAccess(identity, (await params).course);
    const project = await getCurrentLearnerProject(access);
    if (!project) return NextResponse.json({ error: "Learner project not found", code: "project_not_found" }, { status: 404 });
    return NextResponse.json(project);
  } catch (error) {
    return projectError(error, "load");
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ course: string }> }) {
  try {
    const identity = await resolveRequestIdentity(req);
    if (!identity) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const access = await resolvePlayerAccess(identity, (await params).course);
    const body = learnerProjectPutSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await putCurrentLearnerProject(access, body));
  } catch (error) {
    return projectError(error, "save");
  }
}
