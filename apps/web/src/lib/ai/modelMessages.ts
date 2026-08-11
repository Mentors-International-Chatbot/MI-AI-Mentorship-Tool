export type StoredConversationMessage = { role: string; content: string };
export type OrderedModelMessage = { role: "system" | "user" | "assistant"; content: string };

/** Pure ordering seam used by the runtime and the frozen MI regression fixture. */
export function assembleOrderedModelMessages(
  systemPrompt: string,
  history: readonly StoredConversationMessage[],
  incomingText: string,
): OrderedModelMessage[] {
  const ordered: OrderedModelMessage[] = [{ role: "system", content: systemPrompt }];
  for (const message of history) {
    if (message.role === "user") ordered.push({ role: "user", content: message.content });
    if (message.role === "assistant" || message.role === "mentor") ordered.push({ role: "assistant", content: message.content });
  }
  ordered.push({ role: "user", content: incomingText });
  return ordered;
}
