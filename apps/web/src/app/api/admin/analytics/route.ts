import { NextResponse } from 'next/server';
import { requireSystemAdmin } from '@/lib/auth/adminGuard';
import { getSystemAnalytics } from '@/lib/repo/system/analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSystemAdmin();
  if (!auth.authorized) return auth.response;

  return NextResponse.json(await getSystemAnalytics());
}
