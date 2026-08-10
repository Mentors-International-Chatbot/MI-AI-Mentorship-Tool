import { NextRequest, NextResponse } from "next/server";
import { processPendingGrades } from "@/lib/lti/ags";

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await processPendingGrades());
}
