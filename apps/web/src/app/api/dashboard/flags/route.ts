import { NextResponse } from 'next/server';
import { repo } from '@/lib/repo';

export async function GET() {
  const flags = await repo.getAllUnresolvedFlags();
  return NextResponse.json({ flags });
}
