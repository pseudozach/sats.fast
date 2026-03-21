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

  const sparkGetPublicKey = tool(
    async () => {
      try {
        const pubkey = await sparkAdapter.getIdentityPublicKey(userId, mnemonic);
        return `Spark identity public key: ${pubkey}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'spark_get_public_key',
      description: 'Get the user\'s Spark identity public key (hex). This is the primary wallet identifier.',
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
        const status = await liquidAdapter.getWalletStatus(userId, mnemonic);
        const lines = [
          `💵 Liquid USDT: ${bal.usdtBalance.toFixed(2)} USDT`,
          `🔶 L-BTC: ${status.confirmedSat.toLocaleString()} sats`,
        ];
        if (status.pendingReceiveSat > 0) lines.push(`⏳ Pending receive: ${status.pendingReceiveSat.toLocaleString()} sats`);
        if (status.pendingSendSat > 0) lines.push(`⏳ Pending send: ${status.pendingSendSat.toLocaleString()} sats`);
        return lines.join('\n');
      } catch (err: any) {
        return `Error getting Liquid balance: ${err.message}`;
      }
    },
    {
      name: 'liquid_get_balance',
      description: 'Get the user\'s Liquid wallet balances: USDT, L-BTC (confirmed), and any pending amounts.',
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

  /**
   * Helper: given a desired send amount and the user's Spark balance,
   * compute the effective invoice amount that leaves room for Lightning routing fees.
   * Lightning routing fees are typically < 1%, but we reserve 1% + 50 sats buffer.
   */
  function computeInvoiceAmount(requestedSats: number, availableSats: number): number {
    // If user can cover the full amount + generous fee buffer, use the requested amount
    const routingBuffer = Math.max(50, Math.ceil(requestedSats * 0.01)); // 1% or 50 sats min
    if (availableSats >= requestedSats + routingBuffer) {
      return requestedSats;
    }
    // Otherwise, shrink the invoice so Spark has room for routing fees
    // Reserve 1.5% + 50 sats for routing from the available balance
    const reserve = Math.max(50, Math.ceil(availableSats * 0.015));
    return Math.max(0, availableSats - reserve);
  }

  const swapEstimateBtcToUsdt = tool(
    async ({ amountSats }) => {
      try {
        console.log(`[Tool:swap_estimate_btc_to_usdt] amountSats=${amountSats}`);

        // 1. Check Spark balance
        const sparkBalance = await sparkAdapter.getBalance(userId, mnemonic);
        const available = Number(sparkBalance);
        if (available < 100) {
          return JSON.stringify({
            success: false,
            error: `Balance too low to swap: ${available.toLocaleString()} sats. Need at least 100 sats.`,
          });
        }

        // 2. Auto-adjust amount to fit within balance (reserve for routing fees)
        const effectiveSats = computeInvoiceAmount(amountSats, available);
        if (effectiveSats < 100) {
          return JSON.stringify({
            success: false,
            error: `After reserving for Lightning routing fees, only ${effectiveSats} sats would be sent — too low to swap.`,
          });
        }
        const wasAdjusted = effectiveSats < amountSats;

        // 3. Get real-time BTC price
        const price = await getBtcPrice();
        if (price <= 0) {
          return JSON.stringify({ success: false, error: 'Could not fetch BTC/USD price.' });
        }

        // 4. Estimate Lightning bridge fee (Spark → Liquid)
        let lightningReceiveFee = 0;
        let lnLimits = { minSat: 0, maxSat: 0 };
        try {
          const est = await liquidAdapter.estimateLightningReceiveFee(userId, mnemonic, effectiveSats);
          lightningReceiveFee = est.feesSat;
          lnLimits = { minSat: est.minSat, maxSat: est.maxSat };
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `Lightning estimate failed: ${err.message}`,
          });
        }

        // 5. Calculate amounts
        const routingFeeEstimate = amountSats - effectiveSats; // what we reserved for routing
        const lbtcReceived = effectiveSats - lightningReceiveFee; // what Liquid gets
        const grossUsdt = (lbtcReceived / 1e8) * price;
        const swapSpreadPct = 0.1;
        const swapFeeUsdt = grossUsdt * (swapSpreadPct / 100);
        const estimatedUsdt = grossUsdt - swapFeeUsdt;
        const totalFeeSats = routingFeeEstimate + lightningReceiveFee;

        console.log(`[Tool:swap_estimate_btc_to_usdt] price=${price}, effective=${effectiveSats}, lnReceiveFee=${lightningReceiveFee}, routingReserve=${routingFeeEstimate}, net=${estimatedUsdt.toFixed(2)}`);

        return JSON.stringify({
          success: true,
          input: {
            requestedSats: amountSats,
            effectiveSats,
            adjustedForFees: wasAdjusted,
            amountBtc: (effectiveSats / 1e8).toFixed(8),
            amountUsdEquiv: ((effectiveSats / 1e8) * price).toFixed(2),
          },
          fees: {
            lightningRoutingReserve: `~${routingFeeEstimate} sats (~$${((routingFeeEstimate / 1e8) * price).toFixed(2)})`,
            lightningBridgeFee: `${lightningReceiveFee} sats (~$${((lightningReceiveFee / 1e8) * price).toFixed(2)})`,
            swapSpread: `~${swapSpreadPct}% (~$${swapFeeUsdt.toFixed(2)})`,
            totalFeeSats,
            totalFeeUsd: `~$${((totalFeeSats / 1e8) * price + swapFeeUsdt).toFixed(2)}`,
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
        'Automatically adjusts amount down to leave room for Lightning routing fees when converting full balance. ' +
        'Returns detailed fee breakdown. MUST be called before swap_btc_to_usdt.',
      schema: z.object({
        amountSats: z.number().positive().describe('Amount of BTC to convert, in satoshis. Use the full Spark balance for "convert all".'),
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

        // Step 1: Check Spark BTC balance & auto-adjust for fees
        const sparkBalance = await sparkAdapter.getBalance(userId, mnemonic);
        const available = Number(sparkBalance);
        console.log(`[Tool:swap_btc_to_usdt] sparkBalance=${available}`);

        if (available < 100) {
          return JSON.stringify({
            success: false,
            error: `Balance too low to swap: ${available.toLocaleString()} sats.`,
          });
        }

        // Auto-adjust: if requested amount is close to or exceeds balance,
        // shrink to leave room for Lightning routing fees
        const invoiceAmount = computeInvoiceAmount(amountSats, available);
        if (invoiceAmount < 100) {
          return JSON.stringify({
            success: false,
            error: `After reserving for routing fees, only ${invoiceAmount} sats left — too low to swap.`,
          });
        }
        if (invoiceAmount < amountSats) {
          console.log(`[Tool:swap_btc_to_usdt] auto-adjusted ${amountSats} → ${invoiceAmount} to reserve for routing fees`);
        }

        // Step 2: Create a Lightning invoice on the Liquid side for the adjusted amount
        let invoice: string;
        let receiveFee: number;
        try {
          const rcv = await liquidAdapter.createLightningInvoice(userId, mnemonic, invoiceAmount);
          invoice = rcv.invoice;
          receiveFee = rcv.feesSat;
          console.log(`[Tool:swap_btc_to_usdt] Lightning invoice created for ${invoiceAmount} sats, receiveFee=${receiveFee}`);
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: `Cannot create Lightning invoice on Liquid side: ${err.message}`,
          });
        }

        // Step 3: Pay the invoice from Spark (moves BTC → Liquid as L-BTC)
        let sparkPaymentId: string | null = null;
        let actualInvoiceAmount = invoiceAmount;
        try {
          const payResult = await sparkAdapter.payInvoice(userId, mnemonic, invoice, 1000);
          sparkPaymentId = payResult?.id ?? null;
          console.log(`[Tool:swap_btc_to_usdt] Spark payment sent, id=${sparkPaymentId}, status=${payResult?.status}`);
        } catch (err: any) {
          // If still not enough, try once more with a bigger buffer
          if (err.message?.includes('insufficient') || err.message?.includes('fee') || err.message?.includes('balance')) {
            const smallerAmount = Math.floor(invoiceAmount * 0.95);
            console.log(`[Tool:swap_btc_to_usdt] retrying with smaller amount: ${smallerAmount}`);
            if (smallerAmount < 100) {
              return JSON.stringify({ success: false, error: `Balance too small after fee adjustment: ${err.message}` });
            }
            try {
              const rcv2 = await liquidAdapter.createLightningInvoice(userId, mnemonic, smallerAmount);
              const retryPay = await sparkAdapter.payInvoice(userId, mnemonic, rcv2.invoice, 1000);
              receiveFee = rcv2.feesSat;
              actualInvoiceAmount = smallerAmount;
              sparkPaymentId = retryPay?.id ?? null;
              console.log(`[Tool:swap_btc_to_usdt] retry succeeded with ${smallerAmount} sats, id=${sparkPaymentId}`);
            } catch (retryErr: any) {
              return JSON.stringify({
                success: false,
                error: `Failed to pay Lightning invoice from Spark after retry: ${retryErr.message}`,
              });
            }
          } else {
            return JSON.stringify({
              success: false,
              error: `Failed to pay Lightning invoice from Spark: ${err.message}`,
            });
          }
        }

        // Step 4: Wait for L-BTC to arrive in Liquid wallet (confirmed or pending)
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let lbtcBalance = 0;
        let pendingReceive = 0;
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          try {
            const status = await liquidAdapter.getWalletStatus(userId, mnemonic);
            lbtcBalance = status.confirmedSat;
            pendingReceive = status.pendingReceiveSat;
            console.log(`[Tool:swap_btc_to_usdt] poll ${i + 1}/30: confirmed=${lbtcBalance}, pending=${pendingReceive}`);
            if (lbtcBalance > 0) break;
          } catch (pollErr: any) {
            console.log(`[Tool:swap_btc_to_usdt] poll ${i + 1}/30: error=${pollErr.message}`);
          }
        }

        if (lbtcBalance <= 0) {
          // Check Breez payment list for the swap status
          let swapStatus = 'unknown';
          let swapId: string | null = null;
          let claimTxId: string | null = null;
          try {
            const payments = await liquidAdapter.listPayments(userId, mnemonic, 5);
            const recentReceive = payments.find(
              (p) => p.paymentType === 'receive' && p.details?.type === 'lightning'
            );
            if (recentReceive) {
              swapStatus = recentReceive.status;
              const det = recentReceive.details as { swapId?: string; claimTxId?: string };
              swapId = det.swapId ?? null;
              claimTxId = det.claimTxId ?? null;
              console.log(`[Tool:swap_btc_to_usdt] swap found: status=${swapStatus}, swapId=${swapId}, claimTxId=${claimTxId}`);
            }
          } catch (_) { /* best effort */ }

          // If it's pending, it's still in the pipeline — wait longer or report
          const isPending = swapStatus === 'pending' || swapStatus === 'created' || pendingReceive > 0;

          // Auto-save a partial receipt so we have a record
          try {
            await saveReceipt({
              userId: dbUserId,
              actionType: isPending ? 'swap_btc_to_usdt (pending)' : 'swap_btc_to_usdt (timeout)',
              amountSats: actualInvoiceAmount,
              feeSats: receiveFee,
              txId: claimTxId ?? sparkPaymentId ?? undefined,
              extra: { status: swapStatus, sparkPaymentId, swapId, claimTxId, pendingReceive },
            });
          } catch (_) { /* best effort */ }

          const statusMsg = isPending
            ? `BTC was sent and the swap is still processing (pending: ${pendingReceive} sats). This is normal and can take 2-5 minutes. Funds are safe. The conversion will complete automatically in the background and the user will be notified.`
            : `BTC was sent from Spark but hasn't been confirmed yet. Funds are in transit. The conversion will complete automatically in the background and the user will be notified.`;

          return JSON.stringify({
            success: false,
            pending: isPending,
            sparkPaymentId,
            swapId,
            claimTxId,
            swapStatus,
            pendingReceiveSat: pendingReceive,
            error: statusMsg,
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
        const usdtAmount = Math.floor(estimatedUsdt * 100) / 100;
        console.log(`[Tool:swap_btc_to_usdt] btcPrice=${btcPrice}, estimatedUsdt=${estimatedUsdt}, usdtAmount=${usdtAmount}`);

        if (usdtAmount < 0.01) {
          return JSON.stringify({
            success: false,
            error: `L-BTC amount too small to swap (${lbtcBalance} sats ≈ $${(btcAmount * btcPrice).toFixed(2)}).`,
          });
        }

        // Step 6: Swap L-BTC → USDT via self-payment (auto-retries with smaller amounts)
        try {
          const swapResult = await liquidAdapter.swapLbtcToUsdt(userId, mnemonic, usdtAmount);
          const swapTxId = swapResult.txId ?? null;
          const finalUsdt = swapResult.actualUsdtAmount;
          console.log(`[Tool:swap_btc_to_usdt] swap done, feesSat=${swapResult.feesSat}, txId=${swapTxId}, actualUsdt=${finalUsdt}`);

          // Auto-save receipt with all transaction IDs
          const totalFee = receiveFee + (swapResult.feesSat ?? 0);
          let receiptSummary = '';
          try {
            receiptSummary = await saveReceipt({
              userId: dbUserId,
              actionType: 'swap_btc_to_usdt',
              amountSats: actualInvoiceAmount,
              feeSats: totalFee,
              txId: swapTxId ?? sparkPaymentId ?? undefined,
              extra: {
                sparkPaymentId,
                liquidSwapTxId: swapTxId,
                lightningReceiveFee: receiveFee,
                swapFee: swapResult.feesSat,
                usdtReceived: finalUsdt,
                btcPriceUsd: btcPrice,
              },
            });
          } catch (receiptErr: any) {
            console.error(`[Tool:swap_btc_to_usdt] receipt save error:`, receiptErr);
          }

          return JSON.stringify({
            success: true,
            amountSatsSent: actualInvoiceAmount,
            usdtReceived: finalUsdt,
            lightningFee: receiveFee,
            swapFee: swapResult.feesSat,
            sparkPaymentId,
            liquidSwapTxId: swapTxId,
            receiptSaved: !!receiptSummary,
            message: `Converted ${actualInvoiceAmount.toLocaleString()} sats → ~${finalUsdt.toFixed(2)} USDT`,
          });
        } catch (err: any) {
          console.error(`[Tool:swap_btc_to_usdt] swap error:`, err);
          // Save partial receipt for L-BTC that arrived but couldn't swap
          try {
            await saveReceipt({
              userId: dbUserId,
              actionType: 'swap_btc_to_usdt (partial)',
              amountSats: actualInvoiceAmount,
              feeSats: receiveFee,
              txId: sparkPaymentId ?? undefined,
              extra: { status: 'lbtc_arrived_swap_failed', lbtcBalance, sparkPaymentId, error: err.message },
            });
          } catch (_) { /* best effort */ }
          return JSON.stringify({
            success: false,
            sparkPaymentId,
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
        'EXECUTE a BTC → USDT conversion. Automatically reserves sats for Lightning routing fees. ' +
        'If the amount is close to full balance, it auto-adjusts down to ensure the payment succeeds. ' +
        'Takes 10-60 seconds. Returns sparkPaymentId and liquidSwapTxId for tracking. ' +
        'Automatically saves a receipt to the DB — do NOT call receipt_save after this tool. ' +
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
        let swapTxId: string | null = null;
        try {
          const swapResult = await liquidAdapter.swapUsdtToLbtc(userId, mnemonic, lbtcAmountSat);
          swapFee = swapResult.feesSat;
          swapTxId = swapResult.txId ?? null;
          console.log(`[Tool:swap_usdt_to_btc] swap done, feesSat=${swapFee}, txId=${swapTxId}`);
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
          // Save partial receipt
          try {
            await saveReceipt({
              userId: dbUserId,
              actionType: 'swap_usdt_to_btc (partial)',
              amountSats: lbtcAmountSat,
              feeSats: swapFee,
              txId: swapTxId ?? undefined,
              extra: { status: 'lbtc_swapped_invoice_failed', swapTxId, usdtAmount, error: err.message },
            });
          } catch (_) { /* best effort */ }
          return JSON.stringify({
            success: false,
            swapTxId,
            error: `L-BTC swap succeeded but failed to create Spark invoice: ${err.message}. L-BTC is in your Liquid wallet.`,
          });
        }

        // Step 5: Pay the Spark invoice from Liquid L-BTC
        try {
          const payResult = await liquidAdapter.payLightningInvoice(userId, mnemonic, sparkInvoice);
          const lnPayTxId = payResult.txId ?? null;
          console.log(`[Tool:swap_usdt_to_btc] Liquid→Spark Lightning payment sent, feesSat=${payResult.feesSat}, txId=${lnPayTxId}`);

          // Auto-save receipt with all transaction IDs
          const totalFee = swapFee + (payResult.feesSat ?? 0);
          let receiptSummary = '';
          try {
            receiptSummary = await saveReceipt({
              userId: dbUserId,
              actionType: 'swap_usdt_to_btc',
              amountSats: lbtcAmountSat,
              feeSats: totalFee,
              txId: swapTxId ?? lnPayTxId ?? undefined,
              extra: {
                liquidSwapTxId: swapTxId,
                lightningPayTxId: lnPayTxId,
                swapFee,
                lightningFee: payResult.feesSat,
                usdtSent: usdtAmount,
                btcReceivedSats: lbtcAmountSat,
                btcPriceUsd: btcPrice,
              },
            });
          } catch (receiptErr: any) {
            console.error(`[Tool:swap_usdt_to_btc] receipt save error:`, receiptErr);
          }

          return JSON.stringify({
            success: true,
            usdtSent: usdtAmount,
            btcReceivedSats: lbtcAmountSat,
            swapFee,
            lightningFee: payResult.feesSat,
            liquidSwapTxId: swapTxId,
            lightningPayTxId: lnPayTxId,
            receiptSaved: !!receiptSummary,
            message: `Converted ${usdtAmount.toFixed(2)} USDT → ~${lbtcAmountSat.toLocaleString()} sats`,
          });
        } catch (err: any) {
          // Save partial receipt
          try {
            await saveReceipt({
              userId: dbUserId,
              actionType: 'swap_usdt_to_btc (partial)',
              amountSats: lbtcAmountSat,
              feeSats: swapFee,
              txId: swapTxId ?? undefined,
              extra: { status: 'lbtc_swapped_ln_failed', swapTxId, usdtAmount, error: err.message },
            });
          } catch (_) { /* best effort */ }
          return JSON.stringify({
            success: false,
            swapTxId,
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
        'Takes 10-60 seconds. Returns liquidSwapTxId and lightningPayTxId for tracking. ' +
        'Automatically saves a receipt to the DB — do NOT call receipt_save after this tool. ' +
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
      description: 'Save a transaction receipt. MUST be called after every successful write operation EXCEPT swaps (swap tools auto-save receipts). Always include txId if available.',
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
          .map((r, i) => {
            const parts = [
              `${i + 1}. ${r.actionType} — ${r.createdAt}`,
              r.txId ? `   Tx ID: ${r.txId}` : null,
              r.amountSats ? `   Amount: ${r.amountSats.toLocaleString()} sats` : null,
              r.feeSats ? `   Fee: ${r.feeSats} sats` : null,
            ].filter(Boolean);
            // Include extra JSON data if available (contains swap tx IDs, prices, etc.)
            if (r.receiptJson) {
              try {
                const extra = JSON.parse(r.receiptJson);
                if (extra.sparkPaymentId) parts.push(`   Spark Payment ID: ${extra.sparkPaymentId}`);
                if (extra.liquidSwapTxId) parts.push(`   Liquid Swap Tx: ${extra.liquidSwapTxId}`);
                if (extra.lightningPayTxId) parts.push(`   Lightning Pay Tx: ${extra.lightningPayTxId}`);
                if (extra.usdtReceived) parts.push(`   USDT received: ${extra.usdtReceived}`);
                if (extra.usdtSent) parts.push(`   USDT sent: ${extra.usdtSent}`);
                if (extra.btcReceivedSats) parts.push(`   BTC received: ${extra.btcReceivedSats} sats`);
                if (extra.btcPriceUsd) parts.push(`   BTC price: $${extra.btcPriceUsd}`);
                if (extra.status) parts.push(`   Status: ${extra.status}`);
              } catch (_) { /* ignore parse errors */ }
            }
            return parts.join('\n');
          })
          .join('\n\n');
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
    {
      name: 'history_get',
      description: 'Get recent transaction receipts/history for the user. Returns full details including transaction IDs, amounts, fees, and metadata.',
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

  const liquidPayments = tool(
    async ({ limit }) => {
      try {
        console.log(`[Tool:liquid_payments] fetching last ${limit} payments...`);
        const payments = await liquidAdapter.listPayments(userId, mnemonic, limit);
        if (!payments || payments.length === 0) {
          return 'No Liquid/Breez SDK payments found.';
        }
        return payments
          .map((p, i) => {
            const parts = [
              `${i + 1}. ${p.paymentType.toUpperCase()} — ${p.status} — ${p.amountSat.toLocaleString()} sats`,
              `   Fees: ${p.feesSat} sats${p.swapperFeesSat ? ` (swapper: ${p.swapperFeesSat} sats)` : ''}`,
              p.txId ? `   Tx ID: ${p.txId}` : null,
              p.destination ? `   Destination: ${p.destination.substring(0, 40)}...` : null,
              `   Time: ${new Date(p.timestamp * 1000).toISOString()}`,
            ];
            // Add details based on type
            const d = p.details;
            if (d.type === 'lightning') {
              if (d.swapId) parts.push(`   Swap ID: ${d.swapId}`);
              if (d.paymentHash) parts.push(`   Payment Hash: ${d.paymentHash}`);
              if (d.claimTxId) parts.push(`   Claim Tx: ${d.claimTxId}`);
              if (d.refundTxId) parts.push(`   Refund Tx: ${d.refundTxId}`);
              if (d.invoice) parts.push(`   Invoice: ${d.invoice.substring(0, 50)}...`);
            } else if (d.type === 'liquid') {
              parts.push(`   Asset: ${d.assetId === USDT_ASSET_ID ? 'USDT' : d.assetId === LBTC_ASSET_ID ? 'L-BTC' : d.assetId.substring(0, 16)}...`);
            }
            return parts.filter(Boolean).join('\n');
          })
          .join('\n\n');
      } catch (err: any) {
        console.error(`[Tool:liquid_payments] ERROR:`, err);
        return `Error fetching Liquid payments: ${err.message}`;
      }
    },
    {
      name: 'liquid_payments',
      description:
        'List recent payments from the Breez SDK / Liquid wallet. Shows ALL payments including pending swaps, ' +
        'with full details: txId, swapId, paymentHash, claimTxId, status, fees. ' +
        'Use this to investigate where funds went, check swap status, or find transaction IDs.',
      schema: z.object({
        limit: z.number().optional().default(10).describe('Number of payments to retrieve'),
      }),
    }
  );

  const liquidSwapResume = tool(
    async () => {
      try {
        console.log(`[Tool:liquid_swap_resume] checking L-BTC balance...`);

        // Sync and check current L-BTC balance
        const status = await liquidAdapter.getWalletStatus(userId, mnemonic);
        const lbtcBalance = status.confirmedSat;
        console.log(`[Tool:liquid_swap_resume] confirmed=${lbtcBalance}, pending=${status.pendingReceiveSat}`);

        if (lbtcBalance <= 0 && status.pendingReceiveSat > 0) {
          return JSON.stringify({
            success: false,
            error: `No confirmed L-BTC yet, but ${status.pendingReceiveSat.toLocaleString()} sats pending. Wait a few minutes and try again.`,
          });
        }

        if (lbtcBalance <= 0) {
          return JSON.stringify({
            success: false,
            error: 'No L-BTC in Liquid wallet to swap. Nothing to resume.',
          });
        }

        // Get BTC price to calculate a conservative initial USDT estimate
        const btcPrice = await getBtcPrice();
        if (btcPrice <= 0) {
          return JSON.stringify({ success: false, error: 'Could not fetch BTC/USD price.' });
        }

        const btcAmount = lbtcBalance / 1e8;
        const estimatedUsdValue = btcAmount * btcPrice;

        // If the L-BTC value is below $1, it's too small to swap (SideSwap minimums)
        // and is actually useful as a fee reserve for future swaps.
        if (estimatedUsdValue < 1.0) {
          console.log(`[Tool:liquid_swap_resume] lbtcBalance=${lbtcBalance} ≈ $${estimatedUsdValue.toFixed(2)} — below $1 threshold, keeping as fee reserve`);
          return JSON.stringify({
            success: true,
            skipped: true,
            lbtcBalance,
            estimatedUsdValue: estimatedUsdValue.toFixed(2),
            message: `Small L-BTC balance (${lbtcBalance.toLocaleString()} sats ≈ $${estimatedUsdValue.toFixed(2)}) is kept as a fee reserve for future conversions. No swap needed.`,
          });
        }

        // Use 85% as initial estimate — swapLbtcToUsdt will auto-retry with smaller
        // amounts if "not enough funds" (Liquid tx fees eat ~300-500 sats flat)
        const estimatedUsdt = estimatedUsdValue * 0.85;
        const usdtAmount = Math.floor(estimatedUsdt * 100) / 100;
        console.log(`[Tool:liquid_swap_resume] lbtcBalance=${lbtcBalance}, btcPrice=${btcPrice}, initialEstimate=${usdtAmount}`);

        if (usdtAmount < 0.01) {
          return JSON.stringify({
            success: false,
            error: `L-BTC balance too small to swap: ${lbtcBalance} sats ≈ $${estimatedUsdValue.toFixed(2)}.`,
          });
        }

        // Execute the L-BTC → USDT swap (auto-retries with decreasing amounts internally)
        const swapResult = await liquidAdapter.swapLbtcToUsdt(userId, mnemonic, usdtAmount);
        const swapTxId = swapResult.txId ?? null;
        const finalUsdt = swapResult.actualUsdtAmount;
        console.log(`[Tool:liquid_swap_resume] swap done, feesSat=${swapResult.feesSat}, txId=${swapTxId}, actualUsdt=${finalUsdt}`);

        // Auto-save receipt
        try {
          await saveReceipt({
            userId: dbUserId,
            actionType: 'swap_lbtc_to_usdt (resume)',
            amountSats: lbtcBalance,
            feeSats: swapResult.feesSat ?? 0,
            txId: swapTxId ?? undefined,
            extra: {
              liquidSwapTxId: swapTxId,
              swapFee: swapResult.feesSat,
              usdtReceived: finalUsdt,
              btcPriceUsd: btcPrice,
              lbtcInput: lbtcBalance,
            },
          });
        } catch (_) { /* best effort */ }

        return JSON.stringify({
          success: true,
          lbtcSwapped: lbtcBalance,
          usdtReceived: finalUsdt,
          swapFee: swapResult.feesSat,
          liquidSwapTxId: swapTxId,
          receiptSaved: true,
          message: `Swapped ${lbtcBalance.toLocaleString()} sats L-BTC → ~${finalUsdt.toFixed(2)} USDT`,
        });
      } catch (err: any) {
        console.error(`[Tool:liquid_swap_resume] ERROR:`, err);
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'liquid_swap_resume',
      description:
        'Resume/complete a stuck swap by converting any L-BTC sitting in the Liquid wallet into USDT. ' +
        'Use this when a BTC→USDT swap timed out waiting for L-BTC confirmation, but the L-BTC has since arrived. ' +
        'Also useful if the user has L-BTC in their Liquid wallet for any reason and wants to convert to USDT. ' +
        'Automatically saves a receipt.',
      schema: z.object({}),
    }
  );

  return [
    sparkGetBalance,
    sparkGetAddress,
    sparkGetPublicKey,
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
    liquidSwapResume,
    policyCheck,
    policyUpdate,
    receiptSave,
    historyGet,
    liquidPayments,
    btcPrice,
    usdToSats,
  ];
}
