import { mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// Breez SDK Liquid — Node.js submodule
// eslint-disable-next-line @typescript-eslint/no-var-requires
const breezSdkLiquid = require('@breeztech/breez-sdk-liquid/node');
const { connect, defaultConfig } = breezSdkLiquid;

/**
 * USDT asset ID on Liquid mainnet (hardcoded constant).
 */
export const USDT_ASSET_ID =
  'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2';

/**
 * L-BTC asset ID on Liquid mainnet.
 */
export const LBTC_ASSET_ID =
  '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d';

// Types for Breez SDK responses
interface BreezSdk {
  getInfo(): Promise<BreezInfo>;
  prepareSendPayment(req: PrepareSendRequest): Promise<PrepareSendResponse>;
  sendPayment(req: SendRequest): Promise<SendResponse>;
  prepareReceivePayment(req: PrepareReceiveRequest): Promise<PrepareReceiveResponse>;
  receivePayment(req: ReceiveRequest): Promise<ReceiveResponse>;
  fetchFiatRates(): Promise<Rate[]>;
  fetchLightningLimits(): Promise<LightningLimits>;
  listPayments(req: ListPaymentsRequest): Promise<BreezPayment[]>;
  getPayment(req: GetPaymentRequest): Promise<BreezPayment | undefined>;
  sync(): Promise<void>;
  disconnect(): Promise<void>;
  addEventListener(listener: { onEvent: (e: any) => void }): Promise<string>;
  removeEventListener(id: string): Promise<void>;
}

type PaymentState = 'created' | 'pending' | 'complete' | 'failed' | 'timedOut' | 'refundable' | 'refundPending' | 'waitingFeeAcceptance';
type PaymentType = 'receive' | 'send';

/**
 * SDK events emitted by the Breez SDK Liquid.
 * Used by the swap monitor to listen for payment state changes.
 */
export type SdkEvent =
  | { type: 'paymentFailed'; details: any }
  | { type: 'paymentPending'; details: any }
  | { type: 'paymentRefundable'; details: any }
  | { type: 'paymentRefunded'; details: any }
  | { type: 'paymentRefundPending'; details: any }
  | { type: 'paymentSucceeded'; details: any }
  | { type: 'paymentWaitingConfirmation'; details: any }
  | { type: 'paymentWaitingFeeAcceptance'; details: any }
  | { type: 'synced' }
  | { type: 'syncFailed'; error: string }
  | { type: 'dataSynced'; didPullNewRecords: boolean };

interface BreezPayment {
  destination?: string;
  txId?: string;
  timestamp: number;
  amountSat: number;
  feesSat: number;
  swapperFeesSat?: number;
  paymentType: PaymentType;
  status: PaymentState;
  details: BreezPaymentDetails;
}

type BreezPaymentDetails =
  | { type: 'lightning'; swapId: string; description: string; preimage?: string; invoice?: string; paymentHash?: string; claimTxId?: string; refundTxId?: string }
  | { type: 'liquid'; destination: string; description: string; assetId: string }
  | { type: 'bitcoin'; swapId: string; bitcoinAddress: string; description: string; lockupTxId?: string; claimTxId?: string; refundTxId?: string };

interface ListPaymentsRequest {
  filters?: PaymentType[];
  states?: PaymentState[];
  fromTimestamp?: number;
  toTimestamp?: number;
  offset?: number;
  limit?: number;
}

type GetPaymentRequest =
  | { type: 'paymentHash'; paymentHash: string }
  | { type: 'swapId'; swapId: string };

interface BreezInfo {
  walletInfo: {
    balanceSat: number;
    pendingSendSat: number;
    pendingReceiveSat: number;
    assetBalances: AssetBalance[];
  };
}

interface AssetBalance {
  assetId: string;
  balanceSat: number;
  balance?: number;
  name?: string;
  ticker?: string;
}

interface Rate {
  coin: string;
  value: number;
}

interface PrepareSendRequest {
  destination: string;
  amount?: PayAmount;
  disableMrh?: boolean;
  paymentTimeoutSec?: number;
}

type PayAmount =
  | { type: 'bitcoin'; receiverAmountSat: number }
  | { type: 'asset'; toAsset: string; receiverAmount: number; estimateAssetFees?: boolean; fromAsset?: string }
  | { type: 'drain' };

interface PrepareSendResponse {
  feesSat?: number;
  estimatedAssetFees?: number;
  exchangeAmountSat?: number;
  [key: string]: unknown;
}

interface SendRequest {
  prepareResponse: PrepareSendResponse;
}

interface SendResponse {
  payment: unknown;
}

interface PrepareReceiveRequest {
  paymentMethod: 'bolt11Invoice' | 'bolt12Offer' | 'bitcoinAddress' | 'liquidAddress';
  amount?: ReceiveAmount;
}

type ReceiveAmount =
  | { type: 'bitcoin'; payerAmountSat: number }
  | { type: 'asset'; assetId: string; payerAmount?: number };

interface PrepareReceiveResponse {
  paymentMethod: string;
  feesSat: number;
  amount?: ReceiveAmount;
  minPayerAmountSat?: number;
  maxPayerAmountSat?: number;
  [key: string]: unknown;
}

interface LightningLimits {
  send: { minSat: number; maxSat: number };
  receive: { minSat: number; maxSat: number };
}

interface ReceiveRequest {
  prepareResponse: PrepareReceiveResponse;
}

interface ReceiveResponse {
  destination: string;
}

/**
 * Manages per-user Breez SDK Liquid instances.
 * Each user gets their own SDK instance with a unique workingDir.
 */
export class LiquidAdapter {
  private sdks = new Map<string, BreezSdk>();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.DATA_DIR || './data';
  }

  /**
   * Connect (or return existing) Breez SDK for a user.
   */
  async getSdk(userId: string, mnemonic: string): Promise<BreezSdk> {
    if (this.sdks.has(userId)) {
      return this.sdks.get(userId)!;
    }

    const apiKey = process.env.BREEZ_API_KEY;
    if (!apiKey) {
      throw new Error(
        'BREEZ_API_KEY is required. Get a free key at https://breez.technology/request-api-key'
      );
    }

    const workingDir = resolve(this.dataDir, 'breez', userId);
    if (!existsSync(workingDir)) {
      mkdirSync(workingDir, { recursive: true });
    }

    const config = defaultConfig('mainnet', apiKey);
    config.workingDir = workingDir;

    const sdk: BreezSdk = await connect({ mnemonic, config });
    this.sdks.set(userId, sdk);

    return sdk;
  }

  /**
   * Get USDT balance for a user.
   * Returns { usdtBalance, lBtcBalanceSat, pendingSendSat, pendingReceiveSat }.
   */
  async getBalance(
    userId: string,
    mnemonic: string
  ): Promise<{
    usdtBalance: number;
    lBtcBalanceSat: number;
    pendingSendSat: number;
    pendingReceiveSat: number;
  }> {
    const sdk = await this.getSdk(userId, mnemonic);
    const info = await sdk.getInfo();

    let usdtBalance = 0;
    const assetBalances = info.walletInfo?.assetBalances || [];
    const usdtAsset = assetBalances.find(
      (b: AssetBalance) => b.assetId === USDT_ASSET_ID
    );
    if (usdtAsset) {
      usdtBalance = usdtAsset.balance ?? usdtAsset.balanceSat / 1e8;
    }

    return {
      usdtBalance,
      lBtcBalanceSat: info.walletInfo.balanceSat,
      pendingSendSat: info.walletInfo.pendingSendSat,
      pendingReceiveSat: info.walletInfo.pendingReceiveSat,
    };
  }

  /**
   * Prepare to receive USDT. Returns address and fees.
   */
  async prepareReceive(
    userId: string,
    mnemonic: string,
    amount?: number
  ): Promise<{ prepareResponse: PrepareReceiveResponse; feesSat: number }> {
    const sdk = await this.getSdk(userId, mnemonic);

    const req: PrepareReceiveRequest = {
      paymentMethod: 'liquidAddress',
    };

    if (amount !== undefined) {
      req.amount = {
        type: 'asset',
        assetId: USDT_ASSET_ID,
        payerAmount: amount,
      };
    }

    const prepareResponse = await sdk.prepareReceivePayment(req);
    return {
      prepareResponse,
      feesSat: prepareResponse.feesSat,
    };
  }

  /**
   * Execute receive (get the Liquid address).
   */
  async executeReceive(
    userId: string,
    mnemonic: string,
    prepareResponse: PrepareReceiveResponse
  ): Promise<string> {
    const sdk = await this.getSdk(userId, mnemonic);
    const resp = await sdk.receivePayment({ prepareResponse });
    return resp.destination;
  }

  /**
   * Prepare to send USDT. Returns fee estimate.
   */
  async prepareSend(
    userId: string,
    mnemonic: string,
    destination: string,
    amount: number
  ): Promise<{ prepareResponse: PrepareSendResponse; feesSat: number }> {
    const sdk = await this.getSdk(userId, mnemonic);

    const prepareResponse = await sdk.prepareSendPayment({
      destination,
      amount: {
        type: 'asset',
        toAsset: USDT_ASSET_ID,
        receiverAmount: amount,
      },
    });

    return {
      prepareResponse,
      feesSat: prepareResponse.feesSat ?? 0,
    };
  }

  /**
   * Execute a prepared send.
   */
  async executeSend(
    userId: string,
    mnemonic: string,
    prepareResponse: PrepareSendResponse
  ): Promise<unknown> {
    const sdk = await this.getSdk(userId, mnemonic);
    const resp = await sdk.sendPayment({ prepareResponse });
    return resp.payment;
  }

  // ── Cross-asset swap methods ─────────────────────────

  /**
   * Estimate fees for receiving BTC via Lightning into the Liquid wallet.
   * This is non-destructive — only calls prepare, does NOT create an invoice.
   */
  async estimateLightningReceiveFee(
    userId: string,
    mnemonic: string,
    amountSats: number
  ): Promise<{ feesSat: number; minSat: number; maxSat: number }> {
    const sdk = await this.getSdk(userId, mnemonic);
    const limits = await sdk.fetchLightningLimits();

    if (amountSats < limits.receive.minSat || amountSats > limits.receive.maxSat) {
      throw new Error(
        `Amount ${amountSats} sats outside Lightning receive limits (${limits.receive.minSat}–${limits.receive.maxSat} sats)`
      );
    }

    const prep = await sdk.prepareReceivePayment({
      paymentMethod: 'bolt11Invoice',
      amount: { type: 'bitcoin', payerAmountSat: amountSats },
    });

    return {
      feesSat: prep.feesSat,
      minSat: limits.receive.minSat,
      maxSat: limits.receive.maxSat,
    };
  }

  /**
   * Estimate fees for sending L-BTC via Lightning out of the Liquid wallet.
   * Uses fetchLightningLimits and prepareSendPayment for a rough estimate.
   */
  async estimateLightningSendFee(
    userId: string,
    mnemonic: string,
    amountSats: number
  ): Promise<{ estimatedFeeSat: number; minSat: number; maxSat: number }> {
    const sdk = await this.getSdk(userId, mnemonic);
    const limits = await sdk.fetchLightningLimits();

    // Typical Lightning send fee is ~0.1-0.5% on Breez Liquid
    const estimatedFeeSat = Math.max(100, Math.ceil(amountSats * 0.005));

    return {
      estimatedFeeSat,
      minSat: limits.send.minSat,
      maxSat: limits.send.maxSat,
    };
  }

  /**
   * Create a Lightning (bolt11) invoice to receive BTC into the Liquid wallet as L-BTC.
   * This is used to move BTC from Spark → Liquid before swapping to USDT.
   */
  async createLightningInvoice(
    userId: string,
    mnemonic: string,
    amountSats: number
  ): Promise<{ invoice: string; feesSat: number; minSat: number; maxSat: number }> {
    const sdk = await this.getSdk(userId, mnemonic);
    console.log(`[LiquidAdapter:createLightningInvoice] amountSats=${amountSats}`);

    // Check Lightning receive limits
    const limits = await sdk.fetchLightningLimits();
    console.log(`[LiquidAdapter:createLightningInvoice] limits: min=${limits.receive.minSat}, max=${limits.receive.maxSat}`);

    if (amountSats < limits.receive.minSat || amountSats > limits.receive.maxSat) {
      throw new Error(
        `Amount ${amountSats} sats outside Lightning receive limits (${limits.receive.minSat}–${limits.receive.maxSat} sats)`
      );
    }

    const prepareResponse = await sdk.prepareReceivePayment({
      paymentMethod: 'bolt11Invoice',
      amount: { type: 'bitcoin', payerAmountSat: amountSats },
    });

    console.log(`[LiquidAdapter:createLightningInvoice] feesSat=${prepareResponse.feesSat}`);

    const resp = await sdk.receivePayment({ prepareResponse });

    return {
      invoice: resp.destination,
      feesSat: prepareResponse.feesSat,
      minSat: limits.receive.minSat,
      maxSat: limits.receive.maxSat,
    };
  }

  /**
   * Get the L-BTC balance specifically (confirmed + pending receive).
   * Syncs before checking so we get the latest state.
   */
  async getLbtcBalance(userId: string, mnemonic: string): Promise<number> {
    const sdk = await this.getSdk(userId, mnemonic);
    await sdk.sync();
    const info = await sdk.getInfo();
    // Return confirmed balance. Caller can use getWalletStatus for pending detail.
    return info.walletInfo.balanceSat;
  }

  /**
   * Get full wallet status including pending amounts.
   */
  async getWalletStatus(userId: string, mnemonic: string): Promise<{
    confirmedSat: number;
    pendingReceiveSat: number;
    pendingSendSat: number;
  }> {
    const sdk = await this.getSdk(userId, mnemonic);
    await sdk.sync();
    const info = await sdk.getInfo();
    return {
      confirmedSat: info.walletInfo.balanceSat,
      pendingReceiveSat: info.walletInfo.pendingReceiveSat,
      pendingSendSat: info.walletInfo.pendingSendSat,
    };
  }

  /**
   * List recent Breez SDK payments (all types/states).
   */
  async listPayments(
    userId: string,
    mnemonic: string,
    limit: number = 10
  ): Promise<BreezPayment[]> {
    const sdk = await this.getSdk(userId, mnemonic);
    await sdk.sync();
    return sdk.listPayments({ limit });
  }

  /**
   * Look up a specific payment by swapId.
   */
  async getPaymentBySwapId(
    userId: string,
    mnemonic: string,
    swapId: string
  ): Promise<BreezPayment | undefined> {
    const sdk = await this.getSdk(userId, mnemonic);
    await sdk.sync();
    return sdk.getPayment({ type: 'swapId', swapId });
  }

  /**
   * Get fiat exchange rates from the Breez SDK (includes BTC/USD).
   */
  async getFiatRates(userId: string, mnemonic: string): Promise<Rate[]> {
    const sdk = await this.getSdk(userId, mnemonic);
    return sdk.fetchFiatRates();
  }

  /**
   * Swap L-BTC → USDT via self-payment on Liquid network.
   * Uses the Breez SDK's cross-asset payment feature (SideSwap under the hood).
   * Auto-retries with decreasing amounts if fees cause "not enough funds".
   *
   * @param usdtAmount - The desired amount of USDT to receive.
   */
  async swapLbtcToUsdt(
    userId: string,
    mnemonic: string,
    usdtAmount: number
  ): Promise<{ feesSat: number; estimatedAssetFees?: number; txId: string | null; payment: unknown; actualUsdtAmount: number }> {
    const sdk = await this.getSdk(userId, mnemonic);
    console.log(`[LiquidAdapter:swapLbtcToUsdt] requested usdtAmount=${usdtAmount}`);

    // Sync wallet state first
    await sdk.sync();

    // 1. Create a self-receive Liquid address (amountless) — only once
    const prepRcv = await sdk.prepareReceivePayment({
      paymentMethod: 'liquidAddress',
    });
    const rcvRes = await sdk.receivePayment({ prepareResponse: prepRcv });
    const selfAddress = rcvRes.destination;
    console.log(`[LiquidAdapter:swapLbtcToUsdt] selfAddress=${selfAddress.substring(0, 30)}...`);

    // 2. Try prepare+send, reducing the amount on "not enough funds" errors
    let currentAmount = usdtAmount;
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Round to 2 decimal places (USDT precision)
        currentAmount = Math.floor(currentAmount * 100) / 100;
        if (currentAmount < 0.01) {
          throw new Error(`Amount reduced below minimum (0.01 USDT) after ${attempt} retries. Original: ${usdtAmount} USDT.`);
        }

        console.log(`[LiquidAdapter:swapLbtcToUsdt] attempt ${attempt + 1}/${MAX_RETRIES}: ${currentAmount} USDT`);

        const prepSend = await sdk.prepareSendPayment({
          destination: selfAddress,
          amount: {
            type: 'asset',
            toAsset: USDT_ASSET_ID,
            receiverAmount: currentAmount,
            fromAsset: LBTC_ASSET_ID,
          },
        });
        console.log(`[LiquidAdapter:swapLbtcToUsdt] feesSat=${prepSend.feesSat}, estimatedAssetFees=${prepSend.estimatedAssetFees}, exchangeAmountSat=${prepSend.exchangeAmountSat}`);

        // 3. Execute the swap
        const sendRes = await sdk.sendPayment({ prepareResponse: prepSend });
        const payment = sendRes.payment as Record<string, unknown> | undefined;
        const txId = (payment?.txId as string) ?? (payment?.id as string) ?? null;
        console.log(`[LiquidAdapter:swapLbtcToUsdt] swap complete, txId=${txId}, actualAmount=${currentAmount}`);

        return {
          feesSat: prepSend.feesSat ?? 0,
          estimatedAssetFees: prepSend.estimatedAssetFees,
          txId,
          payment,
          actualUsdtAmount: currentAmount,
        };
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('not enough funds') || msg.includes('insufficient') || msg.includes('InsufficientFunds')) {
          // Reduce by 15% and retry
          const reduced = currentAmount * 0.85;
          console.log(`[LiquidAdapter:swapLbtcToUsdt] attempt ${attempt + 1} failed (not enough funds), reducing ${currentAmount} → ${reduced.toFixed(2)} USDT`);
          currentAmount = reduced;
          continue;
        }
        // Non-retryable error
        throw err;
      }
    }

    throw new Error(`Failed to swap L-BTC → USDT after ${MAX_RETRIES} attempts. Last amount tried: ${currentAmount.toFixed(2)} USDT`);
  }

  /**
   * Swap USDT → L-BTC via self-payment on Liquid network.
   * Auto-retries with decreasing amounts if fees cause "not enough funds".
   *
   * @param lbtcAmountSat - The desired amount of L-BTC to receive in sats.
   */
  async swapUsdtToLbtc(
    userId: string,
    mnemonic: string,
    lbtcAmountSat: number
  ): Promise<{ feesSat: number; estimatedAssetFees?: number; txId: string | null; payment: unknown; actualLbtcSat: number }> {
    const sdk = await this.getSdk(userId, mnemonic);
    console.log(`[LiquidAdapter:swapUsdtToLbtc] requested lbtcAmountSat=${lbtcAmountSat}`);

    await sdk.sync();

    // 1. Create self-receive Liquid address — only once
    const prepRcv = await sdk.prepareReceivePayment({
      paymentMethod: 'liquidAddress',
    });
    const rcvRes = await sdk.receivePayment({ prepareResponse: prepRcv });
    const selfAddress = rcvRes.destination;
    console.log(`[LiquidAdapter:swapUsdtToLbtc] selfAddress=${selfAddress.substring(0, 30)}...`);

    // 2. Try prepare+send, reducing on "not enough funds"
    let currentSat = lbtcAmountSat;
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        currentSat = Math.floor(currentSat);
        if (currentSat < 100) {
          throw new Error(`Amount reduced below minimum (100 sats) after ${attempt} retries.`);
        }

        console.log(`[LiquidAdapter:swapUsdtToLbtc] attempt ${attempt + 1}/${MAX_RETRIES}: ${currentSat} sats`);

        const lbtcAmountBtc = currentSat / 1e8;
        console.log(`[LiquidAdapter:swapUsdtToLbtc] prepareSendPayment: dest=${selfAddress.substring(0, 20)}..., toAsset=LBTC, receiverAmount=${lbtcAmountBtc}, fromAsset=USDT`);

        const prepSend = await sdk.prepareSendPayment({
          destination: selfAddress,
          amount: {
            type: 'asset',
            toAsset: LBTC_ASSET_ID,
            receiverAmount: lbtcAmountBtc,
            fromAsset: USDT_ASSET_ID,
          },
        });
        console.log(`[LiquidAdapter:swapUsdtToLbtc] prepareSend OK: feesSat=${prepSend.feesSat}, estimatedAssetFees=${prepSend.estimatedAssetFees}, exchangeAmountSat=${prepSend.exchangeAmountSat}`);

        console.log(`[LiquidAdapter:swapUsdtToLbtc] executing sendPayment...`);
        const sendRes = await sdk.sendPayment({ prepareResponse: prepSend });
        const payment = sendRes.payment as Record<string, unknown> | undefined;
        const txId = (payment?.txId as string) ?? (payment?.id as string) ?? null;
        console.log(`[LiquidAdapter:swapUsdtToLbtc] swap complete, txId=${txId}, actualSat=${currentSat}`);

        return {
          feesSat: prepSend.feesSat ?? 0,
          estimatedAssetFees: prepSend.estimatedAssetFees,
          txId,
          payment,
          actualLbtcSat: currentSat,
        };
      } catch (err: any) {
        const msg = err.message || '';
        console.error(`[LiquidAdapter:swapUsdtToLbtc] attempt ${attempt + 1} ERROR: ${msg}`, err.code || '', err.details || '');
        if (msg.includes('not enough funds') || msg.includes('insufficient') || msg.includes('InsufficientFunds')) {
          const reduced = currentSat * 0.85;
          console.log(`[LiquidAdapter:swapUsdtToLbtc] attempt ${attempt + 1} failed (not enough funds), reducing ${currentSat} → ${Math.floor(reduced)} sats`);
          currentSat = reduced;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Failed to swap USDT → L-BTC after ${MAX_RETRIES} attempts. Last amount tried: ${currentSat} sats`);
  }

  /**
   * Pay a Lightning invoice from the Liquid wallet's L-BTC balance.
   * Used to move L-BTC from Liquid → Spark (by paying a Spark-generated invoice).
   */
  async payLightningInvoice(
    userId: string,
    mnemonic: string,
    bolt11: string
  ): Promise<{ feesSat: number; txId: string | null; payment: unknown }> {
    const sdk = await this.getSdk(userId, mnemonic);
    console.log(`[LiquidAdapter:payLightningInvoice] bolt11=${bolt11.substring(0, 40)}...`);

    const prepareResponse = await sdk.prepareSendPayment({
      destination: bolt11,
    });
    console.log(`[LiquidAdapter:payLightningInvoice] feesSat=${prepareResponse.feesSat}`);

    const sendRes = await sdk.sendPayment({ prepareResponse });
    const payment = sendRes.payment as Record<string, unknown> | undefined;
    const txId = (payment?.txId as string) ?? (payment?.id as string) ?? null;
    console.log(`[LiquidAdapter:payLightningInvoice] payment sent, txId=${txId}`);

    return {
      feesSat: prepareResponse.feesSat ?? 0,
      txId,
      payment,
    };
  }

  /**
   * Check if a user already has an active SDK instance (without connecting).
   */
  hasSdk(userId: string): boolean {
    return this.sdks.has(userId);
  }

  /**
   * Register a Breez SDK event listener for a user.
   * Returns a listenerId that can be used to remove the listener.
   */
  async addEventListener(
    userId: string,
    mnemonic: string,
    callback: (event: SdkEvent) => void
  ): Promise<string> {
    const sdk = await this.getSdk(userId, mnemonic);
    const listenerId = await sdk.addEventListener({ onEvent: callback });
    console.log(`[LiquidAdapter:addEventListener] userId=${userId}, listenerId=${listenerId}`);
    return listenerId;
  }

  /**
   * Remove a Breez SDK event listener for a user.
   */
  async removeEventListener(
    userId: string,
    mnemonic: string,
    listenerId: string
  ): Promise<void> {
    const sdk = await this.getSdk(userId, mnemonic);
    await sdk.removeEventListener(listenerId);
    console.log(`[LiquidAdapter:removeEventListener] userId=${userId}, listenerId=${listenerId}`);
  }

  /**
   * Disconnect a specific user's SDK.
   */
  async disconnectUser(userId: string): Promise<void> {
    const sdk = this.sdks.get(userId);
    if (sdk) {
      try {
        await sdk.disconnect();
      } catch (_) { /* best effort */ }
      this.sdks.delete(userId);
    }
  }

  /**
   * Disconnect all SDK instances (shutdown).
   */
  async disconnectAll(): Promise<void> {
    for (const userId of this.sdks.keys()) {
      await this.disconnectUser(userId);
    }
  }
}

// Singleton instance
export const liquidAdapter = new LiquidAdapter();
