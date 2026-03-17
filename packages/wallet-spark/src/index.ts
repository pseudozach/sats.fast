import WalletManagerSpark from '@tetherto/wdk-wallet-spark';

// Type placeholders — the SDK provides these at runtime
type SparkAccount = Awaited<ReturnType<WalletManagerSpark['getAccount']>>;

interface InvoiceResult {
  id: string;
  invoice: string;
  status: string;
  value: number;
  memo: string;
}

interface PayResult {
  id: string;
  invoice: string;
  status: string;
  fee: number;
}

interface SendResult {
  hash: string;
  fee: bigint;
}

interface Transfer {
  id: string;
  direction: string;
  amount: bigint;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Manages per-user Spark wallet instances.
 * Each user gets a singleton wallet + account based on their mnemonic.
 */
export class SparkAdapter {
  private wallets = new Map<string, WalletManagerSpark>();
  private accounts = new Map<string, SparkAccount>();

  /**
   * Initialize (or return existing) wallet for a user.
   */
  async getAccount(userId: string, mnemonic: string): Promise<SparkAccount> {
    if (this.accounts.has(userId)) {
      return this.accounts.get(userId)!;
    }

    const wallet = new WalletManagerSpark(mnemonic, { network: 'MAINNET' });
    const account = await wallet.getAccount(0);

    this.wallets.set(userId, wallet);
    this.accounts.set(userId, account);

    return account;
  }

  /**
   * Get Spark address for deposits.
   */
  async getAddress(userId: string, mnemonic: string): Promise<string> {
    const account = await this.getAccount(userId, mnemonic);
    return account.getAddress();
  }

  /**
   * Get balance in satoshis.
   */
  async getBalance(userId: string, mnemonic: string): Promise<bigint> {
    const account = await this.getAccount(userId, mnemonic);
    return account.getBalance();
  }

  /**
   * Get Bitcoin L1 single-use deposit address.
   */
  async getDepositAddress(userId: string, mnemonic: string): Promise<string> {
    const account = await this.getAccount(userId, mnemonic);
    return account.getSingleUseDepositAddress();
  }

  /**
   * Create a Lightning invoice.
   */
  async createInvoice(
    userId: string,
    mnemonic: string,
    amountSats: number,
    memo: string = ''
  ): Promise<InvoiceResult> {
    const account = await this.getAccount(userId, mnemonic);
    return account.createLightningInvoice({
      value: amountSats,
      memo,
    }) as Promise<InvoiceResult>;
  }

  /**
   * Pay a Lightning invoice.
   */
  async payInvoice(
    userId: string,
    mnemonic: string,
    invoice: string,
    maxFeeSats: number = 1000
  ): Promise<PayResult> {
    const account = await this.getAccount(userId, mnemonic);
    return account.payLightningInvoice({
      invoice,
      maxFeeSats,
    }) as Promise<PayResult>;
  }

  /**
   * Estimate fee for a Lightning payment.
   */
  async estimateFee(
    userId: string,
    mnemonic: string,
    invoice: string
  ): Promise<number> {
    const account = await this.getAccount(userId, mnemonic);
    return account.getLightningSendFeeEstimate({ invoice });
  }

  /**
   * Send to a Spark address (zero fee).
   */
  async send(
    userId: string,
    mnemonic: string,
    to: string,
    amountSats: number
  ): Promise<SendResult> {
    const account = await this.getAccount(userId, mnemonic);
    return account.sendTransaction({
      to,
      value: amountSats,
    }) as Promise<SendResult>;
  }

  /**
   * Withdraw to a Bitcoin L1 address.
   */
  async withdraw(
    userId: string,
    mnemonic: string,
    to: string,
    amountSats: number
  ): Promise<unknown> {
    const account = await this.getAccount(userId, mnemonic);
    return account.withdraw({ to, value: amountSats });
  }

  /**
   * Get transaction history.
   */
  async getTransfers(
    userId: string,
    mnemonic: string,
    limit: number = 20,
    skip: number = 0
  ): Promise<Transfer[]> {
    const account = await this.getAccount(userId, mnemonic);
    return account.getTransfers({
      direction: 'all',
      limit,
      skip,
    }) as Promise<Transfer[]>;
  }

  /**
   * Dispose a specific user's wallet.
   */
  async disposeUser(userId: string): Promise<void> {
    const account = this.accounts.get(userId);
    const wallet = this.wallets.get(userId);

    try {
      if (account && typeof account.dispose === 'function') {
        account.dispose();
      }
    } catch (_) { /* best effort */ }

    try {
      if (wallet && typeof wallet.dispose === 'function') {
        wallet.dispose();
      }
    } catch (_) { /* best effort */ }

    this.accounts.delete(userId);
    this.wallets.delete(userId);
  }

  /**
   * Dispose all wallets (shutdown).
   */
  async disposeAll(): Promise<void> {
    for (const userId of this.wallets.keys()) {
      await this.disposeUser(userId);
    }
  }
}

// Singleton instance
export const sparkAdapter = new SparkAdapter();
