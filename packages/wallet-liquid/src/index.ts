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
  sync(): Promise<void>;
  disconnect(): Promise<void>;
}

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
   * Get the L-BTC balance specifically.
   */
  async getLbtcBalance(userId: string, mnemonic: string): Promise<number> {
    const sdk = await this.getSdk(userId, mnemonic);
    const info = await sdk.getInfo();
    return info.walletInfo.balanceSat;
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
   *
   * @param usdtAmount - The desired amount of USDT to receive.
   */
  async swapLbtcToUsdt(
    userId: string,
    mnemonic: string,
    usdtAmount: number
  ): Promise<{ feesSat: number; estimatedAssetFees?: number; txId: string | null; payment: unknown }> {
    const sdk = await this.getSdk(userId, mnemonic);
    console.log(`[LiquidAdapter:swapLbtcToUsdt] usdtAmount=${usdtAmount}`);

    // Sync wallet state first
    await sdk.sync();

    // 1. Create a self-receive Liquid address (amountless)
    const prepRcv = await sdk.prepareReceivePayment({
      paymentMethod: 'liquidAddress',
    });
    const rcvRes = await sdk.receivePayment({ prepareResponse: prepRcv });
    const selfAddress = rcvRes.destination;
    console.log(`[LiquidAdapter:swapLbtcToUsdt] selfAddress=${selfAddress.substring(0, 30)}...`);

    // 2. Prepare send to self: L-BTC → USDT
    const prepSend = await sdk.prepareSendPayment({
      destination: selfAddress,
      amount: {
        type: 'asset',
        toAsset: USDT_ASSET_ID,
        receiverAmount: usdtAmount,
        fromAsset: LBTC_ASSET_ID,
      },
    });
    console.log(`[LiquidAdapter:swapLbtcToUsdt] feesSat=${prepSend.feesSat}, estimatedAssetFees=${prepSend.estimatedAssetFees}`);

    // 3. Execute the swap
    const sendRes = await sdk.sendPayment({ prepareResponse: prepSend });
    const payment = sendRes.payment as Record<string, unknown> | undefined;
    const txId = (payment?.txId as string) ?? (payment?.id as string) ?? null;
    console.log(`[LiquidAdapter:swapLbtcToUsdt] swap complete, txId=${txId}`);

    return {
      feesSat: prepSend.feesSat ?? 0,
      estimatedAssetFees: prepSend.estimatedAssetFees,
      txId,
      payment,
    };
  }

  /**
   * Swap USDT → L-BTC via self-payment on Liquid network.
   *
   * @param lbtcAmountSat - The desired amount of L-BTC to receive in sats.
   */
  async swapUsdtToLbtc(
    userId: string,
    mnemonic: string,
    lbtcAmountSat: number
  ): Promise<{ feesSat: number; estimatedAssetFees?: number; txId: string | null; payment: unknown }> {
    const sdk = await this.getSdk(userId, mnemonic);
    console.log(`[LiquidAdapter:swapUsdtToLbtc] lbtcAmountSat=${lbtcAmountSat}`);

    await sdk.sync();

    // 1. Create self-receive Liquid address
    const prepRcv = await sdk.prepareReceivePayment({
      paymentMethod: 'liquidAddress',
    });
    const rcvRes = await sdk.receivePayment({ prepareResponse: prepRcv });
    const selfAddress = rcvRes.destination;
    console.log(`[LiquidAdapter:swapUsdtToLbtc] selfAddress=${selfAddress.substring(0, 30)}...`);

    // 2. Prepare send to self: USDT → L-BTC
    //    receiverAmountSat is in the "toAsset" denomination.
    //    For L-BTC, the SDK uses sats internally but the field is receiverAmount (BTC float).
    const lbtcAmountBtc = lbtcAmountSat / 1e8;
    const prepSend = await sdk.prepareSendPayment({
      destination: selfAddress,
      amount: {
        type: 'asset',
        toAsset: LBTC_ASSET_ID,
        receiverAmount: lbtcAmountBtc,
        fromAsset: USDT_ASSET_ID,
      },
    });
    console.log(`[LiquidAdapter:swapUsdtToLbtc] feesSat=${prepSend.feesSat}, estimatedAssetFees=${prepSend.estimatedAssetFees}`);

    // 3. Execute
    const sendRes = await sdk.sendPayment({ prepareResponse: prepSend });
    const payment = sendRes.payment as Record<string, unknown> | undefined;
    const txId = (payment?.txId as string) ?? (payment?.id as string) ?? null;
    console.log(`[LiquidAdapter:swapUsdtToLbtc] swap complete, txId=${txId}`);

    return {
      feesSat: prepSend.feesSat ?? 0,
      estimatedAssetFees: prepSend.estimatedAssetFees,
      txId,
      payment,
    };
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
