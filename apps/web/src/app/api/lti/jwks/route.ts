import { NextResponse } from "next/server";
import { publicJwks } from "@/lib/lti/crypto";

export async function GET() {
  try { return NextResponse.json(await publicJwks(), { headers: { "Cache-Control": "public, max-age=3600" } }); }
  catch (error) { console.error("LTI JWKS failed", error); return NextResponse.json({ error: "LTI signing key unavailable" }, { status: 503 }); }
}
