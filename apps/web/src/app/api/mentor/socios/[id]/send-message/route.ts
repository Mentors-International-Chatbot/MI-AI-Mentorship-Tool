import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { requireMentorAuth } from '@/lib/auth/mentorAuth';
import { sendWhatsAppMessage } from '@/lib/whatsapp/client';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = requireMentorAuth(request);
    if (authError) return authError;

    const { id } = await params;
    const socio = await repo.getSocioById(id);
    if (!socio) {
        return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
    }

    const body = await request.json();
    const text = body.text;
    if (!text || typeof text !== 'string') {
        return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const message = await repo.addMessage({
        socioId: id,
        role: 'mentor',
        content: text,
    });

    if (socio.channelType === 'whatsapp' && socio.externalId) {
        await sendWhatsAppMessage(socio.externalId, text);
    }

    return NextResponse.json({ message });
}
