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

// Types for Breez SDK responses
interface BreezSdk {
  getInfo(): Promise<BreezInfo>;
  prepareSendPayment(req: PrepareSendRequest): Promise<PrepareSendResponse>;
  sendPayment(req: SendRequest): Promise<SendResponse>;
  prepareReceivePayment(req: PrepareReceiveRequest): Promise<PrepareReceiveResponse>;
  receivePayment(req: ReceiveRequest): Promise<ReceiveResponse>;
  disconnect(): Promise<void>;
}

interface BreezInfo {
  walletInfo: {
    balanceSat: number;
    pendingSendSat: number;
    pendingReceiveSat: number;
  };
  assetBalances?: AssetBalance[];
}

interface AssetBalance {
  assetId: string;
  balanceAmount: number;
}

interface PrepareSendRequest {
  destination: string;
  amount: {
    type: string;
    assetId: string;
    receiverAmount: number;
  };
}

interface PrepareSendResponse {
  feesSat: number;
  [key: string]: unknown;
}

interface SendRequest {
  prepareResponse: PrepareSendResponse;
}

interface SendResponse {
  payment: unknown;
}

interface PrepareReceiveRequest {
  paymentMethod: string;
  amount?: {
    type: string;
    assetId: string;
    payerAmount?: number;
  };
}

interface PrepareReceiveResponse {
  feesSat: number;
  [key: string]: unknown;
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
    if (info.assetBalances) {
      const usdtAsset = info.assetBalances.find(
        (b: AssetBalance) => b.assetId === USDT_ASSET_ID
      );
      if (usdtAsset) {
        usdtBalance = usdtAsset.balanceAmount;
      }
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
        assetId: USDT_ASSET_ID,
        receiverAmount: amount,
      },
    });

    return {
      prepareResponse,
      feesSat: prepareResponse.feesSat,
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
