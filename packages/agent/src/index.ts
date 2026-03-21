import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
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
  return new ChatAnthropic({
    anthropicApiKey: config.apiKey,
    modelName: config.model || 'claude-sonnet-4-6',
    temperature: 0,
    topP: null as unknown as undefined,
    topK: null as unknown as undefined,
    maxTokens: 4096,
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
    const result = await agent.invoke({
      messages: [new HumanMessage(userMessage)],
    });

    // Extract the last AI message
    const messages = result.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg._getType?.() === 'ai' && typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content;
      }
    }

    return 'I processed your request but have no response to show. Please try again.';
  } catch (err: any) {
    console.error('Agent error:', err);

    if (err.message?.includes('API key')) {
      return '❌ AI API key error. Please check your API key with /setkey.';
    }
    if (err.message?.includes('rate limit')) {
      return '⏳ Rate limited by AI provider. Please wait a moment and try again.';
    }

    return `❌ Agent error: ${err.message || 'Unknown error'}. Please try again.`;
  }
}
