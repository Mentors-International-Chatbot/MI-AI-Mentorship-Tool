import { NextRequest, NextResponse } from 'next/server';
import { ChatAnthropic } from '@langchain/anthropic';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { promptContent, testMessage } = body as {
    promptContent: string;
    testMessage: string;
  };

  if (!promptContent || !testMessage) {
    return NextResponse.json(
      { error: 'promptContent and testMessage required' },
      { status: 400 },
    );
  }

  try {
    const chat = new ChatAnthropic({
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await chat.invoke([
      new SystemMessage(promptContent),
      new HumanMessage(testMessage),
    ]);

    return NextResponse.json({
      response: typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content),
    });
  } catch (err) {
    console.error('[test-prompt] AI error:', err);
    return NextResponse.json(
      { error: 'AI call failed' },
      { status: 500 },
    );
  }
}
