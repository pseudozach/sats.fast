const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedPrice: number | null = null;
let lastFetch = 0;

/**
 * Fetch BTC/USD price from CoinGecko. Cached for 60 seconds.
 */
export async function getBtcPrice(): Promise<number> {
  const now = Date.now();
  if (cachedPrice !== null && now - lastFetch < CACHE_TTL_MS) {
    return cachedPrice;
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
    );
    if (!res.ok) {
      throw new Error(`CoinGecko HTTP ${res.status}`);
    }
    const data = (await res.json()) as { bitcoin: { usd: number } };
    cachedPrice = data.bitcoin.usd;
    lastFetch = now;
    return cachedPrice;
  } catch (err) {
    // Return last cached price if available, else a fallback
    if (cachedPrice !== null) return cachedPrice;
    console.error('Failed to fetch BTC price:', err);
    return 0;
  }
}

/**
 * Convert satoshis to approximate USD string.
 */
export async function satsToUsd(sats: number | bigint): Promise<string> {
  const price = await getBtcPrice();
  if (price === 0) return '?.??';
  const btc = Number(sats) / 1e8;
  const usd = btc * price;
  return usd.toFixed(2);
}

/**
 * Format satoshis to BTC string (8 decimal places).
 */
export function satsToBtc(sats: number | bigint): string {
  const btc = Number(sats) / 1e8;
  return btc.toFixed(8);
}

/**
 * Get current UTC timestamp string.
 */
export function nowUtc(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/**
 * Truncate a string in the middle (for addresses/invoices).
 */
export function truncateMiddle(str: string, maxLen: number = 20): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, half)}...${str.slice(-half)}`;
}
