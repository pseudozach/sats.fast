import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { sparkAdapter } from '@sats-fast/wallet-spark';
import { liquidAdapter } from '@sats-fast/wallet-liquid';
import { checkPolicy, updatePolicyRule, getPolicyRules } from '@sats-fast/policy';
import { saveReceipt, getReceipts } from '@sats-fast/receipts';
import { satsToBtc, satsToUsd } from '@sats-fast/shared';

/**
 * Factory that creates all agent tools bound to a specific user.
 * The mnemonic is provided at creation time so tools don't need it as input.
 */
export function createUserTools(userId: string, dbUserId: number, mnemonic: string) {
  // ── Spark (Lightning BTC) tools ──────────────────────

  const sparkGetBalance = tool(
    async () => {
      try {
        console.log(`[Tool:spark_get_balance] fetching...`);
        const balance = await sparkAdapter.getBalance(userId, mnemonic);
        const btc = satsToBtc(balance);
        const usd = await satsToUsd(balance);
        console.log(`[Tool:spark_get_balance] balance=${balance}, btc=${btc}, usd=${usd}`);
        return `\u26a1 Lightning BTC (Spark)\nBalance: ${btc} BTC (${Number(balance).toLocaleString()} sats)\n\u2248 $${usd} USD`;
      } catch (err: any) {
        console.error(`[Tool:spark_get_balance] ERROR:`, err);
        return `Error getting Spark balance: ${err.message}`;
      }
    },
    {
      name: 'spark_get_balance',
      description: 'Get the user\'s Lightning BTC balance on Spark.',
      schema: z.object({}),
    }
  );

  const sparkGetAddress = tool(
    async () => {
      try {
        const addr = await sparkAdapter.getAddress(userId, mnemonic);
        return `Spark address: ${addr}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'spark_get_address',
      description: 'Get the user\'s Spark wallet address for receiving.',
      schema: z.object({}),
    }
  );

  const sparkGetDepositAddress = tool(
    async () => {
      try {
        const addr = await sparkAdapter.getDepositAddress(userId, mnemonic);
        return `Bitcoin L1 deposit address (single-use): ${addr}\n\nSend BTC on-chain to this address. It will appear in your Spark balance after confirmations.`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'spark_get_deposit_address',
      description: 'Get a single-use Bitcoin L1 deposit address to fund the Spark wallet.',
      schema: z.object({}),
    }
  );

  const sparkCreateInvoice = tool(
    async ({ amountSats, memo }) => {
      try {
        console.log(`[Tool:spark_create_invoice] amountSats=${amountSats}, memo="${memo}"`);
        const result = await sparkAdapter.createInvoice(userId, mnemonic, amountSats, memo);
        // LightningReceiveRequest.invoice is an Invoice object with encodedInvoice
        const bolt11 = result?.invoice?.encodedInvoice || result?.invoice || 'unknown';
        console.log(`[Tool:spark_create_invoice] bolt11=${String(bolt11).substring(0, 50)}...`);
        return `Lightning invoice created:\n\n${bolt11}\n\nAmount: ${amountSats.toLocaleString()} sats\nMemo: ${memo || 'none'}`;
      } catch (err: any) {
        console.error(`[Tool:spark_create_invoice] ERROR:`, err);
        return `Error creating invoice: ${err.message}`;
      }
    },
    {
      name: 'spark_create_invoice',
      description: 'Create a Lightning invoice to receive BTC. Returns a BOLT11 invoice string.',
      schema: z.object({
        amountSats: z.number().positive().describe('Amount in satoshis'),
        memo: z.string().optional().default('').describe('Optional memo/description'),
      }),
    }
  );

  const sparkFeeEstimate = tool(
    async ({ invoice }) => {
      try {
        console.log(`[Tool:spark_fee_estimate] invoice=${invoice.substring(0, 40)}...`);
        const fee = await sparkAdapter.estimateFee(userId, mnemonic, invoice);
        console.log(`[Tool:spark_fee_estimate] fee=${fee}`);
        return `Estimated Lightning routing fee: ${fee} sats`;
      } catch (err: any) {
        console.error(`[Tool:spark_fee_estimate] ERROR:`, err);
        return `Error estimating fee: ${err.message}`;
      }
    },
    {
      name: 'spark_fee_estimate',
      description: 'Estimate the Lightning routing fee for paying a BOLT11 invoice.',
      schema: z.object({
        invoice: z.string().describe('BOLT11 Lightning invoice'),
      }),
    }
  );

  const sparkPayInvoice = tool(
    async ({ invoice, maxFeeSats }) => {
      try {
        console.log(`[Tool:spark_pay_invoice] invoice=${invoice.substring(0, 40)}..., maxFeeSats=${maxFeeSats}`);
        const result = await sparkAdapter.payInvoice(userId, mnemonic, invoice, maxFeeSats);
        console.log(`[Tool:spark_pay_invoice] result:`, JSON.stringify(result, null, 2));
        return JSON.stringify({
          success: true,
          id: result.id,
          status: result.status,
          fee: result.fee,
        });
      } catch (err: any) {
        console.error(`[Tool:spark_pay_invoice] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'spark_pay_invoice',
      description: 'Pay a Lightning invoice. MUST call policy_check first. MUST call receipt_save after.',
      schema: z.object({
        invoice: z.string().describe('BOLT11 Lightning invoice to pay'),
        maxFeeSats: z.number().optional().default(1000).describe('Maximum fee in sats'),
      }),
    }
  );

  const sparkSend = tool(
    async ({ to, amountSats }) => {
      try {
        console.log(`[Tool:spark_send] to=${to}, amountSats=${amountSats}`);
        const result = await sparkAdapter.send(userId, mnemonic, to, amountSats);
        console.log(`[Tool:spark_send] result:`, JSON.stringify(result, null, 2));
        return JSON.stringify({
          success: true,
          hash: result.hash,
          fee: 0,
        });
      } catch (err: any) {
        console.error(`[Tool:spark_send] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'spark_send',
      description: 'Send BTC to a Spark address (zero fee). MUST call policy_check first. MUST call receipt_save after.',
      schema: z.object({
        to: z.string().describe('Spark address (spark1...)'),
        amountSats: z.number().positive().describe('Amount in satoshis'),
      }),
    }
  );

  const sparkGetHistory = tool(
    async ({ limit }) => {
      try {
        const transfers = await sparkAdapter.getTransfers(userId, mnemonic, limit);
        if (!transfers || transfers.length === 0) {
          return 'No Spark transactions found.';
        }
        return transfers
          .map((t, i) => `${i + 1}. ${t.direction} ${Number(t.amount).toLocaleString()} sats — ${t.timestamp || 'unknown time'}`)
          .join('\n');
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'spark_get_history',
      description: 'Get recent Lightning/Spark transaction history.',
      schema: z.object({
        limit: z.number().optional().default(10).describe('Number of transactions to retrieve'),
      }),
    }
  );

  // ── Liquid USDT tools ────────────────────────────────

  const liquidGetBalance = tool(
    async () => {
      try {
        const bal = await liquidAdapter.getBalance(userId, mnemonic);
        return `💵 Liquid USDT\nBalance: ${bal.usdtBalance.toFixed(2)} USDT`;
      } catch (err: any) {
        return `Error getting Liquid balance: ${err.message}`;
      }
    },
    {
      name: 'liquid_get_balance',
      description: 'Get the user\'s Liquid USDT balance.',
      schema: z.object({}),
    }
  );

  const liquidGetAddress = tool(
    async () => {
      try {
        const { prepareResponse, feesSat } = await liquidAdapter.prepareReceive(userId, mnemonic);
        const address = await liquidAdapter.executeReceive(userId, mnemonic, prepareResponse);
        return `Liquid USDT receive address:\n${address}\n\nFee: ${feesSat} sats`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'liquid_get_address',
      description: 'Get a Liquid address to receive USDT.',
      schema: z.object({}),
    }
  );

  const liquidSendPrepare = tool(
    async ({ destination, amount }) => {
      try {
        const { feesSat } = await liquidAdapter.prepareSend(userId, mnemonic, destination, amount);
        return JSON.stringify({
          success: true,
          feesSat,
          destination,
          amount,
          message: `Sending ${amount} USDT to ${destination}. Network fee: ${feesSat} sats. Confirm to proceed.`,
        });
      } catch (err: any) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'liquid_send_prepare',
      description: 'Prepare a USDT send on Liquid. Returns fee estimate. Does NOT execute the send.',
      schema: z.object({
        destination: z.string().describe('Liquid address or BIP21 URI'),
        amount: z.number().positive().describe('Amount in USDT'),
      }),
    }
  );

  const liquidSendExecute = tool(
    async ({ destination, amount }) => {
      try {
        const { prepareResponse } = await liquidAdapter.prepareSend(userId, mnemonic, destination, amount);
        const payment = await liquidAdapter.executeSend(userId, mnemonic, prepareResponse);
        return JSON.stringify({ success: true, payment });
      } catch (err: any) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'liquid_send_execute',
      description: 'Execute a USDT send on Liquid. MUST call policy_check first. MUST call receipt_save after.',
      schema: z.object({
        destination: z.string().describe('Liquid address'),
        amount: z.number().positive().describe('Amount in USDT'),
      }),
    }
  );

  const liquidReceivePrepare = tool(
    async ({ amount }) => {
      try {
        const { feesSat } = await liquidAdapter.prepareReceive(userId, mnemonic, amount);
        return JSON.stringify({
          success: true,
          feesSat,
          message: `Receive ${amount ? amount + ' USDT' : 'USDT'}. Fee: ${feesSat} sats.`,
        });
      } catch (err: any) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'liquid_receive_prepare',
      description: 'Prepare to receive USDT on Liquid. Returns fee estimate.',
      schema: z.object({
        amount: z.number().optional().describe('Expected USDT amount (optional)'),
      }),
    }
  );

  const liquidReceiveExecute = tool(
    async ({ amount }) => {
      try {
        const { prepareResponse } = await liquidAdapter.prepareReceive(userId, mnemonic, amount);
        const address = await liquidAdapter.executeReceive(userId, mnemonic, prepareResponse);
        return `Liquid receive address: ${address}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'liquid_receive_execute',
      description: 'Generate a Liquid address for receiving USDT.',
      schema: z.object({
        amount: z.number().optional().describe('Expected USDT amount (optional)'),
      }),
    }
  );

  // ── Policy tools ─────────────────────────────────────

  const policyCheck = tool(
    async ({ actionType, amountSats, destination }) => {
      try {
        const result = await checkPolicy({
          userId: dbUserId,
          actionType,
          amountSats,
          destination,
        });
        return JSON.stringify(result);
      } catch (err: any) {
        return JSON.stringify({ decision: 'blocked', reason: `Policy error: ${err.message}` });
      }
    },
    {
      name: 'policy_check',
      description: 'Check if an action is allowed by user policy. MUST be called before any send/pay operation.',
      schema: z.object({
        actionType: z.string().describe('Type of action: send, pay_invoice, withdraw, etc.'),
        amountSats: z.number().describe('Amount in satoshis'),
        destination: z.string().optional().describe('Destination address or invoice'),
      }),
    }
  );

  const policyUpdate = tool(
    async ({ field, value }) => {
      try {
        const msg = await updatePolicyRule(dbUserId, field as any, value);
        return msg;
      } catch (err: any) {
        return `Error updating policy: ${err.message}`;
      }
    },
    {
      name: 'policy_update',
      description: 'Update a user policy setting. Fields: daily_limit, per_tx, auto_approve, autopilot.',
      schema: z.object({
        field: z.enum(['daily_limit', 'per_tx', 'auto_approve', 'autopilot']).describe('Policy field to update'),
        value: z.number().describe('New value (sats for limits, 0/1 for autopilot)'),
      }),
    }
  );

  // ── Receipt tools ────────────────────────────────────

  const receiptSave = tool(
    async ({ actionType, amountSats, feeSats, txId, destination, policyNote }) => {
      try {
        const summary = await saveReceipt({
          userId: dbUserId,
          actionType,
          amountSats,
          feeSats,
          txId,
          destination,
          policyNote,
        });
        return summary;
      } catch (err: any) {
        return `Error saving receipt: ${err.message}`;
      }
    },
    {
      name: 'receipt_save',
      description: 'Save a transaction receipt. MUST be called after every successful write operation.',
      schema: z.object({
        actionType: z.string().describe('Type of action performed'),
        amountSats: z.number().optional().describe('Amount in satoshis'),
        feeSats: z.number().optional().describe('Fee in satoshis'),
        txId: z.string().optional().describe('Transaction ID or hash'),
        destination: z.string().optional().describe('Destination address'),
        policyNote: z.string().optional().describe('Policy decision note'),
      }),
    }
  );

  const historyGet = tool(
    async ({ limit }) => {
      try {
        const items = await getReceipts(dbUserId, limit);
        if (items.length === 0) {
          return 'No transaction history yet.';
        }
        return items
          .map((r, i) => `${i + 1}. ${r.actionType} — ${r.summary.split('\n').slice(0, 3).join(' | ')}`)
          .join('\n\n');
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'history_get',
      description: 'Get recent transaction receipts/history for the user.',
      schema: z.object({
        limit: z.number().optional().default(10).describe('Number of receipts to retrieve'),
      }),
    }
  );

  return [
    sparkGetBalance,
    sparkGetAddress,
    sparkGetDepositAddress,
    sparkCreateInvoice,
    sparkFeeEstimate,
    sparkPayInvoice,
    sparkSend,
    sparkGetHistory,
    liquidGetBalance,
    liquidGetAddress,
    liquidSendPrepare,
    liquidSendExecute,
    liquidReceivePrepare,
    liquidReceiveExecute,
    policyCheck,
    policyUpdate,
    receiptSave,
    historyGet,
  ];
}
