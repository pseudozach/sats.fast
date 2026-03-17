export declare function runAgent(
  userMessage: string,
  agentConfig: {
    provider: 'openai' | 'anthropic';
    apiKey: string;
    model: string;
  },
  userContext: {
    userId: string;
    dbUserId: number;
    mnemonic: string;
  }
): Promise<string>;

export declare function createUserTools(
  userId: string,
  dbUserId: number,
  mnemonic: string
): any[];

export declare const SYSTEM_PROMPT: string;
