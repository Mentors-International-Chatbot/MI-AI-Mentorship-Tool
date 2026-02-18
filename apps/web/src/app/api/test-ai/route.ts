import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai/service';

// Simple test endpoint - remove before production
export async function POST(req: NextRequest) {
    try {
        const { message } = await req.json();

        if (!message) {
            return NextResponse.json({ error: 'Missing "message" in body' }, { status: 400 });
        }

        // Create a fake ACTIVE socio for testing
        const fakeSocio = {
            id: 'test-user',
            whatsappPhoneNumber: '0000000000',
            name: 'Test User',
            status: 'ACTIVE' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const aiResponse = await generateAIResponse(fakeSocio, message);

        return NextResponse.json({ response: aiResponse });
    } catch (error) {
        console.error('Test AI Error:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
