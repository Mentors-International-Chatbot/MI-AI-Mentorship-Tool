import { NextRequest, NextResponse } from 'next/server';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { verifyMentorOwnership } from '@/lib/auth/ownership';
import { createOpenRouterChat, resolveOpenRouterModel } from '@/lib/ai/openrouter';
import { invokeTraced } from '@/lib/ai/trace/invokeTraced';
import { loadActivePrompt } from '@/lib/ai/prompts/loadPrompt';
import { loadMentorAssistantContext, renderContextBlock } from '@/lib/ai/mentorAssistant/context';
import { mentorAssistantTools, CONFIRM_REQUIRED_TOOLS, type ConfirmRequiredTool } from '@/lib/ai/mentorAssistant/tools';
import { executeSummarizeHistory } from '@/lib/ai/mentorAssistant/execute';

const DEFAULT_PROMPT = [
  'You are a mentor\'s assistant inside a dashboard panel for one specific learner.',
  'You may propose exactly one tool call per turn when the mentor asks for an action; otherwise reply in plain text.',
  'Never claim an action has happened until you are told it succeeded — proposing a tool call is not the same as it running.',
  'Keep replies short. This is a working tool, not a chat companion.',
].join(' ');

type ChatTurn = { role: 'user' | 'assistant'; content: string };

function isConfirmRequired(name: string): name is ConfirmRequiredTool {
  return (CONFIRM_REQUIRED_TOOLS as readonly string[]).includes(name);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: socioId } = await params;

  const auth = await verifyMentorOwnership(socioId);
  if (!auth.authorized) return auth.response;

  const body = (await req.json().catch(() => null)) as { messages?: ChatTurn[] } | null;
  const turns = Array.isArray(body?.messages) ? body.messages : null;
  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  let context;
  try {
    context = await loadMentorAssistantContext(socioId);
  } catch {
    return NextResponse.json({ error: 'Socio not found' }, { status: 404 });
  }

  const promptText = await loadActivePrompt('mentor_assistant', DEFAULT_PROMPT);
  const systemPrompt = `${promptText}\n\n${renderContextBlock(context)}`;

  const langchainMessages = [
    new SystemMessage(systemPrompt),
    ...turns.map((t) => (t.role === 'user' ? new HumanMessage(t.content) : new AIMessage(t.content))),
  ];

  const model = resolveOpenRouterModel();
  const chat = createOpenRouterChat({ temperature: 0.2, maxTokens: 800 }).bindTools(mentorAssistantTools);

  let response: AIMessage;
  try {
    response = await invokeTraced({
      operation: 'mentor_assistant',
      model,
      promptVersion: {},
      systemPrompt,
      socioId,
      organizationId: undefined,
      invoke: () => chat.invoke(langchainMessages) as unknown as Promise<AIMessage>,
    });
  } catch (error) {
    console.error('[MentorAssistant] LLM call failed:', error);
    return NextResponse.json({ error: 'Assistant is unavailable right now.' }, { status: 502 });
  }

  const toolCall = response.tool_calls?.[0];

  if (!toolCall) {
    return NextResponse.json({ type: 'text', content: String(response.content ?? '') });
  }

  if (!isConfirmRequired(toolCall.name)) {
    // Only remaining possibility is the read-only summarize_history — run it now
    // and let the model phrase the answer, no confirm card needed for a read.
    try {
      const data = await executeSummarizeHistory(socioId);
      const followUp = await chat.invoke([
        ...langchainMessages,
        response,
        new ToolMessage({
          tool_call_id: toolCall.id ?? 'summarize_history',
          content: JSON.stringify(data),
        }),
      ]);
      return NextResponse.json({ type: 'text', content: String(followUp.content ?? '') });
    } catch (error) {
      console.error('[MentorAssistant] summarize_history failed:', error);
      return NextResponse.json({ error: 'Could not read this learner\'s history.' }, { status: 500 });
    }
  }

  return NextResponse.json({
    type: 'proposal',
    proposal: { name: toolCall.name, args: toolCall.args },
    assistantText: typeof response.content === 'string' ? response.content : null,
  });
}
