import { NextRequest, NextResponse } from 'next/server';
import { repo } from '@/lib/repo';
import { sendWhatsAppMessage } from '@/lib/whatsapp/client';
import { verifyMentorOwnership } from '@/lib/auth/ownership';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    const auth = await verifyMentorOwnership(id);
    if (!auth.authorized) return auth.response;

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
