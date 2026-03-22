import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { createUserTools } from './tools';
import { SYSTEM_PROMPT } from './prompt';

export { createUserTools } from './tools';
export { SYSTEM_PROMPT } from './prompt';

interface AgentConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
}

interface UserContext {
  userId: string;
  dbUserId: number;
  mnemonic: string;
}

// ── Per-user conversation history ───────────────────
const MAX_HISTORY = 20; // max messages to keep per user
const HISTORY_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface ConversationEntry {
  messages: BaseMessage[];
  lastActivity: number;
}

const conversations = new Map<string, ConversationEntry>();

/**
 * Get (or create) conversation history for a user.
 * Expires after HISTORY_TTL_MS of inactivity.
 */
function getHistory(userId: string): BaseMessage[] {
  const entry = conversations.get(userId);
  if (!entry) return [];
  // Expire stale conversations
  if (Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
    conversations.delete(userId);
    return [];
  }
  return entry.messages;
}

function pushHistory(userId: string, human: string, assistant: string): void {
  const entry = conversations.get(userId) || { messages: [], lastActivity: 0 };
  entry.messages.push(new HumanMessage(human));
  entry.messages.push(new AIMessage(assistant));
  // Trim to MAX_HISTORY (keep most recent pairs)
  while (entry.messages.length > MAX_HISTORY) {
    entry.messages.shift();
  }
  entry.lastActivity = Date.now();
  conversations.set(userId, entry);
}

/**
 * Clear conversation history for a user.
 */
export function clearHistory(userId: string): void {
  conversations.delete(userId);
}

/**
 * Create an LLM instance based on provider config.
 */
function createLLM(config: AgentConfig): BaseChatModel {
  if (config.provider === 'openai') {
    return new ChatOpenAI({
      openAIApiKey: config.apiKey,
      modelName: config.model || 'gpt-4o-mini',
      temperature: 0,
    }) as unknown as BaseChatModel;
  }

  // Default: Anthropic
  // Only set temperature — Anthropic rejects top_p + temperature together,
  // and LangChain defaults topP to -1 which is also invalid.
  // Use invocationKwargs to override the raw API payload after LangChain builds it.
  return new ChatAnthropic({
    anthropicApiKey: config.apiKey,
    modelName: config.model || 'claude-sonnet-4-6',
    maxTokens: 4096,
    invocationKwargs: { temperature: 0, top_p: undefined, top_k: undefined },
  }) as unknown as BaseChatModel;
}

/**
 * Create and invoke the agent for a single user message.
 * Returns the agent's text response.
 */
export async function runAgent(
  userMessage: string,
  agentConfig: AgentConfig,
  userContext: UserContext
): Promise<string> {
  const llm = createLLM(agentConfig);
  const tools = createUserTools(
    userContext.userId,
    userContext.dbUserId,
    userContext.mnemonic
  );

  const agent = createReactAgent({
    llm,
    tools,
    prompt: SYSTEM_PROMPT,
  });

  try {
    // Build messages: past conversation + new user message
    const history = getHistory(userContext.userId);
    const allMessages = [...history, new HumanMessage(userMessage)];

    // Timeout: abort the agent if it takes more than 120 seconds
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let result;
    try {
      result = await agent.invoke(
        { messages: allMessages },
        { recursionLimit: 30, signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    // Extract the last AI message
    const messages = result.messages;
    let aiResponse = 'I processed your request but have no response to show. Please try again.';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg._getType?.() === 'ai' && typeof msg.content === 'string' && msg.content.trim()) {
        aiResponse = msg.content;
        break;
      }
    }

    // Save to conversation history
    pushHistory(userContext.userId, userMessage, aiResponse);

    return aiResponse;
  } catch (err: any) {
    console.error('Agent error:', err?.message || err);

    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      return '⏳ That took too long. The operation may still be processing in the background. Please check /balance in a minute.';
    }
    if (err.message?.includes('API key')) {
      return '❌ AI API key error. Please check your API key with /setkey.';
    }
    if (err.message?.includes('rate limit')) {
      return '⏳ Rate limited by AI provider. Please wait a moment and try again.';
    }

    return `❌ Something went wrong. Please try again.`;
  }
}
