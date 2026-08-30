// Server-only market data access (free public Yahoo Finance endpoints, NSE equities).
import type { Candle } from "./indicators";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";

// Small in-process response cache: the free feed rate-limits aggressively (429),
// and small-cap daily data does not need sub-minute freshness.
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function yfRaw<T>(url: string): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Rotate between the two public hosts — their rate-limit buckets differ.
    const target = attempt === 0 ? url : url.replace("query1.", "query2.").replace("query2.", attempt === 1 ? "query1." : "query2.");
    const res = await fetch(target, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;
    lastErr = new Error(
      res.status === 429
        ? "Market data feed is rate limiting us right now — wait a few seconds and retry."
        : `Market data request failed (${res.status})`,
    );
    if (res.status !== 429 && res.status < 500) break;
    await sleep(600 * (attempt + 1));
  }
  throw lastErr ?? new Error("Market data request failed");
}

async function yf<T>(url: string, ttlMs = 5 * 60_000): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;
  const p = yfRaw<T>(url)
    .then((v) => {
      cache.set(url, { at: Date.now(), value: v });
      return v;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}


export type ChartResult = {
  symbol: string;
  currency: string;
  exchange: string;
  price: number;
  previousClose: number;
  candles: Candle[];
};

export async function fetchChart(symbol: string, range = "2y", interval = "1d"): Promise<ChartResult> {
  const data = await yf<any>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
  );
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(`No market data found for ${symbol}`);
  const q = r.indicators?.quote?.[0] ?? {};
  const ts: number[] = r.timestamp ?? [];
  const candles: Candle[] = [];
  ts.forEach((t, i) => {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if ([o, h, l, c].every((x) => typeof x === "number" && isFinite(x))) {
      candles.push({ t, o, h, l, c, v: typeof v === "number" ? v : 0 });
    }
  });
  if (candles.length < 30) throw new Error(`Not enough price history for ${symbol}`);
  return {
    symbol: r.meta?.symbol ?? symbol,
    currency: r.meta?.currency ?? "INR",
    exchange: r.meta?.fullExchangeName ?? "NSE",
    price: r.meta?.regularMarketPrice ?? candles[candles.length - 1]!.c,
    previousClose: r.meta?.chartPreviousClose ?? candles[candles.length - 2]?.c ?? candles[0]!.c,
    candles,
  };
}

export type SearchHit = {
  symbol: string;
  name: string;
  exchange: string;
  sector?: string;
  industry?: string;
};

export type NewsItem = { title: string; publisher: string; link: string; time: number | null };

export async function fetchSearch(query: string): Promise<{ hits: SearchHit[]; news: NewsItem[] }> {
  const data = await yf<any>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=8`,
  );
  const hits: SearchHit[] = (data?.quotes ?? [])
    .filter((q: any) => q.quoteType === "EQUITY" && typeof q.symbol === "string")
    .map((q: any) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchDisp ?? q.exchange ?? "",
      sector: q.sectorDisp ?? q.sector,
      industry: q.industryDisp ?? q.industry,
    }));
  const news: NewsItem[] = (data?.news ?? []).map((n: any) => ({
    title: n.title,
    publisher: n.publisher ?? "",
    link: n.link ?? "",
    time: n.providerPublishTime ?? null,
  }));
  return { hits, news };
}

/** Resolve a free-text company name / ticker to an NSE equity symbol. */
export async function resolveSymbol(query: string): Promise<SearchHit | null> {
  const q = query.trim();
  if (!q) return null;
  const direct = /\.(NS|BO)$/i.test(q) ? q.toUpperCase() : null;
  const { hits } = await fetchSearch(q.replace(/\.(NS|BO)$/i, ""));
  if (direct) {
    const exact = hits.find((h) => h.symbol.toUpperCase() === direct);
    if (exact) return exact;
    return { symbol: direct, name: direct.replace(/\.(NS|BO)$/i, ""), exchange: "NSE" };
  }
  const nse = hits.find((h) => h.symbol.endsWith(".NS"));
  if (nse) return nse;
  const bse = hits.find((h) => h.symbol.endsWith(".BO"));
  if (bse) return { ...bse, symbol: bse.symbol.replace(".BO", ".NS") };
  return null;
}

export type QuoteLite = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  spark: number[];
};

export async function fetchQuoteLite(symbol: string, name: string): Promise<QuoteLite | null> {
  try {
    const data = await yf<any>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`,
    );
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const closes: number[] = (r.indicators?.quote?.[0]?.close ?? []).filter(
      (x: unknown): x is number => typeof x === "number",
    );
    if (!closes.length) return null;
    const price = r.meta?.regularMarketPrice ?? closes[closes.length - 1];
    const prev = r.meta?.chartPreviousClose ?? closes[closes.length - 2] ?? price;
    return {
      symbol,
      name,
      price,
      changePct: ((price - prev) / prev) * 100,
      volume: r.meta?.regularMarketVolume ?? 0,
      spark: closes.slice(-22),
    };
  } catch {
    return null;
  }
}

export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}
