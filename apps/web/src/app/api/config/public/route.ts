import { NextResponse } from 'next/server';
import { getChatbotDisplayName } from '@/lib/config/service';

export async function GET() {
  const chatbotName = await getChatbotDisplayName().catch(() => 'Mentor Virtual');
  return NextResponse.json({ chatbotName });
}
