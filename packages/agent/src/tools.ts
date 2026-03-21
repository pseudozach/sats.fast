import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { sparkAdapter } from '@sats-fast/wallet-spark';
import { liquidAdapter, LBTC_ASSET_ID, USDT_ASSET_ID } from '@sats-fast/wallet-liquid';
import { checkPolicy, updatePolicyRule, getPolicyRules } from '@sats-fast/policy';
import { saveReceipt, getReceipts } from '@sats-fast/receipts';
import { satsToBtc, satsToUsd, getBtcPrice } from '@sats-fast/shared';

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

  // ── Cross-asset swap tools ───────────────────────────

  const swapEstimateBtcToUsdt = tool(
    async ({ amountSats }) => {
      try {
        console.log(`[Tool:swap_estimate_btc_to_usdt] amountSats=${amountSats}`);

        // 1. Check Spark balance
        const sparkBalance = await sparkAdapter.getBalance(userId, mnemonic);
        const available = Number(sparkBalance);
        if (available < amountSats) {
          return JSON.stringify({
            success: false,
            error: `Insufficient Spark balance: ${available.toLocaleString()} sats available, need ${amountSats.toLocaleString()} sats`,
          });
        }

        // 2. Get real-time BTC price
        const price = await getBtcPrice();
        if (price <= 0) {
          return JSON.stringify({ success: false, error: 'Could not fetch BTC/USD price.' });
        }

        // 3. Estimate Lightning bridge fee (Spark → Liquid)
        let lightningReceiveFee = 0;
        let lnLimits = { minSat: 0, maxSat: 0 };
        try {
          const est = await liquidAdapter.estimateLightningReceiveFee(userId, mnemonic, amountSats);
          lightningReceiveFee = est.feesSat;
          lnLimits = { minSat: est.minSat, maxSat: est.maxSat };
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `Lightning estimate failed: ${err.message}`,
          });
        }

        // 4. Calculate amounts
        const lbtcAfterLnFee = amountSats - lightningReceiveFee;
        const grossUsdt = (lbtcAfterLnFee / 1e8) * price;
        // SideSwap typically charges ~0.1% for L-BTC ↔ USDT swaps
        const swapSpreadPct = 0.1;
        const swapFeeUsdt = grossUsdt * (swapSpreadPct / 100);
        const estimatedUsdt = grossUsdt - swapFeeUsdt;

        console.log(`[Tool:swap_estimate_btc_to_usdt] price=${price}, lnFee=${lightningReceiveFee}, gross=${grossUsdt.toFixed(2)}, net=${estimatedUsdt.toFixed(2)}`);

        return JSON.stringify({
          success: true,
          input: {
            amountSats,
            amountBtc: (amountSats / 1e8).toFixed(8),
            amountUsdEquiv: ((amountSats / 1e8) * price).toFixed(2),
          },
          fees: {
            lightningBridgeFee: `${lightningReceiveFee} sats (~$${((lightningReceiveFee / 1e8) * price).toFixed(2)})`,
            swapSpread: `~${swapSpreadPct}% (~$${swapFeeUsdt.toFixed(2)})`,
            totalFeeUsd: `~$${(((lightningReceiveFee / 1e8) * price) + swapFeeUsdt).toFixed(2)}`,
          },
          output: {
            estimatedUsdt: estimatedUsdt.toFixed(2),
            note: 'Actual USDT received may vary ±1-2% due to real-time swap rates.',
          },
          btcPriceUsd: price,
          lightningLimits: lnLimits,
        });
      } catch (err: any) {
        console.error(`[Tool:swap_estimate_btc_to_usdt] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'swap_estimate_btc_to_usdt',
      description:
        'Estimate fees and output for converting BTC → USDT WITHOUT executing. ' +
        'Returns detailed fee breakdown: Lightning bridge fee, swap spread, estimated USDT output. ' +
        'MUST be called before swap_btc_to_usdt so the user can review fees.',
      schema: z.object({
        amountSats: z.number().positive().describe('Amount of BTC to convert, in satoshis'),
      }),
    }
  );

  const swapEstimateUsdtToBtc = tool(
    async ({ usdtAmount }) => {
      try {
        console.log(`[Tool:swap_estimate_usdt_to_btc] usdtAmount=${usdtAmount}`);

        // 1. Check USDT balance
        const bal = await liquidAdapter.getBalance(userId, mnemonic);
        if (bal.usdtBalance < usdtAmount) {
          return JSON.stringify({
            success: false,
            error: `Insufficient USDT balance: ${bal.usdtBalance.toFixed(2)} USDT available, need ${usdtAmount.toFixed(2)} USDT`,
          });
        }

        // 2. Get real-time BTC price
        const price = await getBtcPrice();
        if (price <= 0) {
          return JSON.stringify({ success: false, error: 'Could not fetch BTC/USD price.' });
        }

        // 3. Calculate amounts
        const grossBtc = usdtAmount / price;
        const grossSats = Math.floor(grossBtc * 1e8);

        // SideSwap spread ~0.1%
        const swapSpreadPct = 0.1;
        const swapFeeSats = Math.ceil(grossSats * (swapSpreadPct / 100));
        const lbtcAfterSwap = grossSats - swapFeeSats;

        // 4. Estimate Lightning send fee (Liquid → Spark)
        let lightningSendFee = 0;
        let lnLimits = { minSat: 0, maxSat: 0 };
        try {
          const est = await liquidAdapter.estimateLightningSendFee(userId, mnemonic, lbtcAfterSwap);
          lightningSendFee = est.estimatedFeeSat;
          lnLimits = { minSat: est.minSat, maxSat: est.maxSat };
        } catch (_) {
          lightningSendFee = Math.max(100, Math.ceil(lbtcAfterSwap * 0.005));
        }

        const finalSats = lbtcAfterSwap - lightningSendFee;
        const totalFeeSats = swapFeeSats + lightningSendFee;

        console.log(`[Tool:swap_estimate_usdt_to_btc] price=${price}, grossSats=${grossSats}, swapFee=${swapFeeSats}, lnFee=${lightningSendFee}, net=${finalSats}`);

        return JSON.stringify({
          success: true,
          input: {
            usdtAmount: usdtAmount.toFixed(2),
          },
          fees: {
            swapSpread: `~${swapSpreadPct}% (~${swapFeeSats.toLocaleString()} sats)`,
            lightningBridgeFee: `~${lightningSendFee.toLocaleString()} sats`,
            totalFeeSats: `~${totalFeeSats.toLocaleString()} sats (~$${((totalFeeSats / 1e8) * price).toFixed(2)})`,
          },
          output: {
            estimatedSats: finalSats,
            estimatedBtc: (finalSats / 1e8).toFixed(8),
            estimatedUsd: ((finalSats / 1e8) * price).toFixed(2),
            note: 'Actual BTC received may vary ±1-2% due to real-time swap rates.',
          },
          btcPriceUsd: price,
          lightningLimits: lnLimits,
        });
      } catch (err: any) {
        console.error(`[Tool:swap_estimate_usdt_to_btc] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'swap_estimate_usdt_to_btc',
      description:
        'Estimate fees and output for converting USDT → BTC WITHOUT executing. ' +
        'Returns detailed fee breakdown: swap spread, Lightning bridge fee, estimated sats output. ' +
        'MUST be called before swap_usdt_to_btc so the user can review fees.',
      schema: z.object({
        usdtAmount: z.number().positive().describe('Amount of USDT to convert'),
      }),
    }
  );

  const swapBtcToUsdt = tool(
    async ({ amountSats }) => {
      try {
        console.log(`[Tool:swap_btc_to_usdt] amountSats=${amountSats}`);

        // Step 1: Check Spark BTC balance
        const sparkBalance = await sparkAdapter.getBalance(userId, mnemonic);
        console.log(`[Tool:swap_btc_to_usdt] sparkBalance=${sparkBalance}`);
        if (Number(sparkBalance) < amountSats) {
          return JSON.stringify({
            success: false,
            error: `Insufficient Spark balance: ${Number(sparkBalance).toLocaleString()} sats available, need ${amountSats.toLocaleString()} sats`,
          });
        }

        // Step 2: Create a Lightning invoice on the Liquid side to receive L-BTC
        let invoice: string;
        let receiveFee: number;
        try {
          const rcv = await liquidAdapter.createLightningInvoice(userId, mnemonic, amountSats);
          invoice = rcv.invoice;
          receiveFee = rcv.feesSat;
          console.log(`[Tool:swap_btc_to_usdt] Lightning invoice created, receiveFee=${receiveFee}`);
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `Cannot create Lightning invoice on Liquid side: ${err.message}`,
          });
        }

        // Step 3: Pay the invoice from Spark (moves BTC → Liquid as L-BTC)
        try {
          const payResult = await sparkAdapter.payInvoice(userId, mnemonic, invoice, 1000);
          console.log(`[Tool:swap_btc_to_usdt] Spark payment sent, status=${payResult?.status}`);
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `Failed to pay Lightning invoice from Spark: ${err.message}`,
          });
        }

        // Step 4: Wait for L-BTC to arrive in Liquid wallet
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let lbtcBalance = 0;
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          lbtcBalance = await liquidAdapter.getLbtcBalance(userId, mnemonic);
          console.log(`[Tool:swap_btc_to_usdt] poll ${i + 1}/30: lbtcBalance=${lbtcBalance}`);
          if (lbtcBalance > 0) break;
        }

        if (lbtcBalance <= 0) {
          return JSON.stringify({
            success: false,
            error: 'BTC was sent to Liquid wallet but L-BTC has not arrived yet. This can take a few minutes. Please try checking your balance again shortly.',
          });
        }

        // Step 5: Estimate USDT amount from the L-BTC balance
        const btcPrice = await getBtcPrice();
        if (btcPrice <= 0) {
          return JSON.stringify({
            success: false,
            error: 'Could not fetch BTC/USD price for swap estimation.',
          });
        }
        const btcAmount = lbtcBalance / 1e8;
        // Use 95% of estimated USDT to account for swap slippage and fees
        const estimatedUsdt = btcAmount * btcPrice * 0.95;
        const usdtAmount = Math.floor(estimatedUsdt * 100) / 100; // round down to 2 decimals
        console.log(`[Tool:swap_btc_to_usdt] btcPrice=${btcPrice}, estimatedUsdt=${estimatedUsdt}, usdtAmount=${usdtAmount}`);

        if (usdtAmount < 0.01) {
          return JSON.stringify({
            success: false,
            error: `L-BTC amount too small to swap (${lbtcBalance} sats ≈ $${(btcAmount * btcPrice).toFixed(2)}).`,
          });
        }

        // Step 6: Swap L-BTC → USDT via self-payment
        try {
          const swapResult = await liquidAdapter.swapLbtcToUsdt(userId, mnemonic, usdtAmount);
          console.log(`[Tool:swap_btc_to_usdt] swap done, feesSat=${swapResult.feesSat}`);

          return JSON.stringify({
            success: true,
            amountSatsSent: amountSats,
            usdtReceived: usdtAmount,
            lightningFee: receiveFee,
            swapFee: swapResult.feesSat,
            message: `Converted ${amountSats.toLocaleString()} sats → ~${usdtAmount.toFixed(2)} USDT`,
          });
        } catch (err: any) {
          console.error(`[Tool:swap_btc_to_usdt] swap error:`, err);
          return JSON.stringify({
            success: false,
            error: `L-BTC arrived (${lbtcBalance} sats) but swap to USDT failed: ${err.message}. The L-BTC is safe in your Liquid wallet.`,
          });
        }
      } catch (err: any) {
        console.error(`[Tool:swap_btc_to_usdt] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'swap_btc_to_usdt',
      description:
        'EXECUTE a BTC → USDT conversion. Moves BTC from Spark → Liquid via Lightning, then swaps L-BTC → USDT. ' +
        'Takes 10-60 seconds. ' +
        'MUST call swap_estimate_btc_to_usdt first and show fees to user. ' +
        'MUST call policy_check with actionType "swap". ' +
        'Only execute AFTER user confirms the fee breakdown.',
      schema: z.object({
        amountSats: z.number().positive().describe('Amount of BTC to convert, in satoshis'),
      }),
    }
  );

  const swapUsdtToBtc = tool(
    async ({ usdtAmount }) => {
      try {
        console.log(`[Tool:swap_usdt_to_btc] usdtAmount=${usdtAmount}`);

        // Step 1: Check USDT balance
        const bal = await liquidAdapter.getBalance(userId, mnemonic);
        console.log(`[Tool:swap_usdt_to_btc] usdtBalance=${bal.usdtBalance}`);
        if (bal.usdtBalance < usdtAmount) {
          return JSON.stringify({
            success: false,
            error: `Insufficient USDT balance: ${bal.usdtBalance.toFixed(2)} USDT available, need ${usdtAmount.toFixed(2)} USDT`,
          });
        }

        // Step 2: Estimate L-BTC amount from USDT
        const btcPrice = await getBtcPrice();
        if (btcPrice <= 0) {
          return JSON.stringify({
            success: false,
            error: 'Could not fetch BTC/USD price for swap estimation.',
          });
        }
        // Use 95% to account for slippage
        const estimatedBtc = (usdtAmount / btcPrice) * 0.95;
        const lbtcAmountSat = Math.floor(estimatedBtc * 1e8);
        console.log(`[Tool:swap_usdt_to_btc] btcPrice=${btcPrice}, estimatedBtc=${estimatedBtc}, lbtcAmountSat=${lbtcAmountSat}`);

        // Step 3: Swap USDT → L-BTC via self-payment
        let swapFee = 0;
        try {
          const swapResult = await liquidAdapter.swapUsdtToLbtc(userId, mnemonic, lbtcAmountSat);
          swapFee = swapResult.feesSat;
          console.log(`[Tool:swap_usdt_to_btc] swap done, feesSat=${swapFee}`);
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `USDT → L-BTC swap failed: ${err.message}`,
          });
        }

        // Step 4: Create Lightning invoice on Spark to receive the BTC
        let sparkInvoice: string;
        try {
          const invoiceResult = await sparkAdapter.createInvoice(userId, mnemonic, lbtcAmountSat, 'USDT→BTC swap');
          sparkInvoice = invoiceResult?.invoice?.encodedInvoice || invoiceResult?.invoice;
          console.log(`[Tool:swap_usdt_to_btc] Spark invoice created`);
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `L-BTC swap succeeded but failed to create Spark invoice: ${err.message}. L-BTC is in your Liquid wallet.`,
          });
        }

        // Step 5: Pay the Spark invoice from Liquid L-BTC
        try {
          const payResult = await liquidAdapter.payLightningInvoice(userId, mnemonic, sparkInvoice);
          console.log(`[Tool:swap_usdt_to_btc] Liquid→Spark Lightning payment sent, feesSat=${payResult.feesSat}`);

          return JSON.stringify({
            success: true,
            usdtSent: usdtAmount,
            btcReceivedSats: lbtcAmountSat,
            swapFee,
            lightningFee: payResult.feesSat,
            message: `Converted ${usdtAmount.toFixed(2)} USDT → ~${lbtcAmountSat.toLocaleString()} sats`,
          });
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `USDT→L-BTC swap succeeded but Lightning payment to Spark failed: ${err.message}. BTC is in your Liquid wallet as L-BTC.`,
          });
        }
      } catch (err: any) {
        console.error(`[Tool:swap_usdt_to_btc] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'swap_usdt_to_btc',
      description:
        'EXECUTE a USDT → BTC conversion. Swaps USDT → L-BTC on Liquid, then sends L-BTC to Spark via Lightning. ' +
        'Takes 10-60 seconds. ' +
        'MUST call swap_estimate_usdt_to_btc first and show fees to user. ' +
        'MUST call policy_check with actionType "swap". ' +
        'Only execute AFTER user confirms the fee breakdown.',
      schema: z.object({
        usdtAmount: z.number().positive().describe('Amount of USDT to convert'),
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

  // ── Price / conversion tools ──────────────────────

  const btcPrice = tool(
    async () => {
      try {
        const price = await getBtcPrice();
        if (price === 0) {
          return 'Error: unable to fetch BTC price right now.';
        }
        console.log(`[Tool:get_btc_price] price=$${price}`);
        return JSON.stringify({
          btcPriceUsd: price,
          source: 'CoinGecko',
          note: 'Cached up to 60 s',
        });
      } catch (err: any) {
        console.error(`[Tool:get_btc_price] ERROR:`, err);
        return `Error fetching BTC price: ${err.message}`;
      }
    },
    {
      name: 'get_btc_price',
      description:
        'Get the current real-time BTC/USD price from CoinGecko. ' +
        'MUST be called whenever you need to convert between USD and sats. ' +
        'NEVER estimate or guess the BTC price from your training data.',
      schema: z.object({}),
    }
  );

  const usdToSats = tool(
    async ({ usd }) => {
      try {
        const price = await getBtcPrice();
        if (price === 0) {
          return 'Error: unable to fetch BTC price right now.';
        }
        const btc = usd / price;
        const sats = Math.round(btc * 1e8);
        console.log(`[Tool:usd_to_sats] $${usd} @ $${price}/BTC = ${sats} sats`);
        return JSON.stringify({
          usd,
          btcPriceUsd: price,
          sats,
          btc: btc.toFixed(8),
        });
      } catch (err: any) {
        console.error(`[Tool:usd_to_sats] ERROR:`, err);
        return `Error converting USD to sats: ${err.message}`;
      }
    },
    {
      name: 'usd_to_sats',
      description:
        'Convert a USD amount to satoshis using the real-time BTC price. ' +
        'MUST be used when the user specifies an amount in dollars (e.g. "$5 of BTC").',
      schema: z.object({
        usd: z.number().positive().describe('Amount in US dollars'),
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
    swapEstimateBtcToUsdt,
    swapEstimateUsdtToBtc,
    swapBtcToUsdt,
    swapUsdtToBtc,
    policyCheck,
    policyUpdate,
    receiptSave,
    historyGet,
    btcPrice,
    usdToSats,
  ];
}
