import { NextRequest, NextResponse } from "next/server";
import { exchangeLtiSession } from "@/lib/lti/provision";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { code?: unknown };
  if (typeof body.code !== "string" || !body.code) return NextResponse.json({ error: "Missing exchange code" }, { status: 400 });
  const session = await exchangeLtiSession(body.code);
  if (!session) return NextResponse.json({ error: "Invalid, expired, or already used exchange code" }, { status: 401 });
  return NextResponse.json({ token: session.bearerToken, destination: session.destination }, { headers: { "Cache-Control": "no-store" } });
}
