import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// POST — submit feedback
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { page, subject, body: feedbackBody } = body;

    if (!page || !subject || !feedbackBody) {
      return NextResponse.json(
        { error: 'page, subject, and body are required' },
        { status: 400 },
      );
    }

    const feedback = await prisma.feedback.create({
      data: { page, subject, body: feedbackBody },
    });

    return NextResponse.json(feedback, { status: 201 });
  } catch (error) {
    console.error('Feedback POST error:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}

// GET — list all feedback (for admin report)
export async function GET() {
  try {
    const feedback = await prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(feedback);
  } catch (error) {
    console.error('Feedback GET error:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}
