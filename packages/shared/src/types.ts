export interface UserRecord {
  id: number;
  telegramId: string;
  username: string | null;
  seedEnc: string;
  createdAt: string;
}

export interface ProviderConfig {
  id: number;
  userId: number;
  provider: 'openai' | 'anthropic';
  apiKeyEnc: string;
  model: string;
  createdAt: string;
}

export interface PolicyRule {
  userId: number;
  dailyLimitSats: number;
  perTxLimitSats: number;
  autoApproveSats: number;
  autopilot: number;
  allowlistJson: string;
}

export interface PendingApproval {
  id: number;
  userId: number;
  actionJson: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  resolvedAt: string | null;
}

export interface Receipt {
  id: number;
  userId: number;
  actionType: string;
  amountSats: number | null;
  feeSats: number | null;
  txId: string | null;
  summary: string;
  receiptJson: string;
  createdAt: string;
}

export interface PolicyDecision {
  decision: 'approved' | 'requires_confirmation' | 'blocked';
  reason: string;
}

export interface ReceiptData {
  action: string;
  amount: string;
  fee: string;
  to: string;
  txId: string;
  time: string;
  model: string;
  policyNote: string;
}

export interface WalletBalances {
  spark: {
    balanceSats: bigint;
    balanceBtc: string;
    usdValue: string;
  };
  liquid: {
    usdtBalance: number;
  };
}
