// Pure technical-analysis helpers: indicators, chart-pattern recognition and
// a composite directional score. No I/O, safe to import anywhere.

export type Candle = {
  t: number; // epoch seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Pattern = {
  name: string;
  kind: "bullish" | "bearish" | "neutral";
  strength: number; // 0..1 reliability weight
  detail: string;
};

export const sma = (v: number[], p: number): (number | null)[] =>
  v.map((_, i) => (i + 1 < p ? null : v.slice(i + 1 - p, i + 1).reduce((a, b) => a + b, 0) / p));

export function ema(v: number[], p: number): (number | null)[] {
  const k = 2 / (p + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  v.forEach((x, i) => {
    if (i + 1 < p) return out.push(null);
    if (prev === null) prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
    else prev = x * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function rsi(v: number[], p = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let g = 0;
  let l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const up = Math.max(d, 0);
    const dn = Math.max(-d, 0);
    if (i <= p) {
      g += up / p;
      l += dn / p;
      out.push(i === p ? 100 - 100 / (1 + g / (l || 1e-9)) : null);
    } else {
      g = (g * (p - 1) + up) / p;
      l = (l * (p - 1) + dn) / p;
      out.push(100 - 100 / (1 + g / (l || 1e-9)));
    }
  }
  return out;
}

export function macd(v: number[]) {
  const f = ema(v, 12);
  const s = ema(v, 26);
  const line = v.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  const valid = line.map((x) => x ?? 0);
  const sig = ema(valid, 9);
  const hist = line.map((x, i) => (x != null && sig[i] != null ? x - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

export function atr(c: Candle[], p = 14): (number | null)[] {
  const tr = c.map((x, i) =>
    i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c)),
  );
  return sma(tr, p);
}

export function bollinger(v: number[], p = 20, k = 2) {
  const mid = sma(v, p);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const width: (number | null)[] = [];
  v.forEach((_, i) => {
    const m = mid[i];
    if (m == null) {
      upper.push(null);
      lower.push(null);
      width.push(null);
      return;
    }
    const w = v.slice(i + 1 - p, i + 1);
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / p);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
    width.push((2 * k * sd) / m);
  });
  return { mid, upper, lower, width };
}

const last = <T,>(a: T[]) => a[a.length - 1];
const pct = (a: number, b: number) => ((a - b) / b) * 100;

/** Pivot highs/lows used for structural pattern recognition. */
function pivots(c: Candle[], span = 3) {
  const hi: { i: number; p: number }[] = [];
  const lo: { i: number; p: number }[] = [];
  for (let i = span; i < c.length - span; i++) {
    const w = c.slice(i - span, i + span + 1);
    if (c[i]!.h >= Math.max(...w.map((x) => x.h))) hi.push({ i, p: c[i]!.h });
    if (c[i]!.l <= Math.min(...w.map((x) => x.l))) lo.push({ i, p: c[i]!.l });
  }
  return { hi, lo };
}

/** Classic chart + candlestick pattern recognition on daily candles. */
export function detectPatterns(c: Candle[]): Pattern[] {
  const out: Pattern[] = [];
  if (c.length < 40) return out;
  const close = c.map((x) => x.c);
  const vol = c.map((x) => x.v);
  const n = c.length;
  const px = close[n - 1]!;
  const s20 = last(sma(close, 20));
  const s50 = last(sma(close, 50));
  const s200 = c.length >= 200 ? last(sma(close, 200)) : null;
  const prev50 = sma(close, 50)[n - 6];
  const prev20 = sma(close, 20)[n - 6];
  const r = last(rsi(close));
  const m = macd(close);
  const { hi, lo } = pivots(c);
  const bb = bollinger(close);
  const avgVol20 = vol.slice(-20).reduce((a, b) => a + b, 0) / 20;

  // --- Moving-average structure
  if (s20 && s50 && prev20 && prev50) {
    if (s20 > s50 && prev20 <= prev50)
      out.push({ name: "Golden Cross (20/50)", kind: "bullish", strength: 0.75, detail: "Short-term average has just crossed above the medium-term average — classic trend-start signal." });
    if (s20 < s50 && prev20 >= prev50)
      out.push({ name: "Death Cross (20/50)", kind: "bearish", strength: 0.75, detail: "Short-term average cut below the medium-term average — momentum is rolling over." });
  }
  if (s200 && px > s200 && s50 && s50 > s200)
    out.push({ name: "Primary Uptrend", kind: "bullish", strength: 0.6, detail: "Price and the 50-day average are both above the 200-day average." });
  if (s200 && px < s200)
    out.push({ name: "Below 200-DMA", kind: "bearish", strength: 0.5, detail: "Trading under the long-term trend line — institutional demand is weak." });

  // --- Breakout / breakdown vs 20-day range
  const hi20 = Math.max(...c.slice(-21, -1).map((x) => x.h));
  const lo20 = Math.min(...c.slice(-21, -1).map((x) => x.l));
  if (px > hi20)
    out.push({ name: "20-Day Range Breakout", kind: "bullish", strength: 0.8, detail: `Closed above the prior 20-day high of ₹${hi20.toFixed(2)}.` });
  if (px < lo20)
    out.push({ name: "20-Day Breakdown", kind: "bearish", strength: 0.8, detail: `Closed below the prior 20-day low of ₹${lo20.toFixed(2)}.` });

  // --- Volume confirmation
  if (last(vol) > 2 * avgVol20)
    out.push({
      name: "Volume Spike",
      kind: close[n - 1]! > close[n - 2]! ? "bullish" : "bearish",
      strength: 0.65,
      detail: `Traded ${(last(vol) / avgVol20).toFixed(1)}x the 20-day average volume — institutional footprint.`,
    });
  if (last(vol) < 0.5 * avgVol20 && px > (s20 ?? px))
    out.push({ name: "Low-Volume Drift", kind: "neutral", strength: 0.3, detail: "Advance is not backed by volume; treat the move as fragile." });

  // --- Double bottom / double top
  if (lo.length >= 2) {
    const a = lo[lo.length - 2]!;
    const b = lo[lo.length - 1]!;
    if (b.i > n - 40 && Math.abs(pct(b.p, a.p)) < 3 && b.i - a.i > 8 && px > Math.max(a.p, b.p) * 1.03)
      out.push({ name: "Double Bottom", kind: "bullish", strength: 0.8, detail: `Two lows near ₹${a.p.toFixed(2)} held and price has reclaimed the neckline.` });
  }
  if (hi.length >= 2) {
    const a = hi[hi.length - 2]!;
    const b = hi[hi.length - 1]!;
    if (b.i > n - 40 && Math.abs(pct(b.p, a.p)) < 3 && b.i - a.i > 8 && px < Math.min(a.p, b.p) * 0.97)
      out.push({ name: "Double Top", kind: "bearish", strength: 0.8, detail: `Rejected twice near ₹${a.p.toFixed(2)} and has lost the neckline.` });
  }

  // --- Head & shoulders (3 pivot highs, middle highest)
  if (hi.length >= 3) {
    const l1 = hi[hi.length - 3]!;
    const h2 = hi[hi.length - 2]!;
    const r3 = hi[hi.length - 1]!;
    if (h2.p > l1.p && h2.p > r3.p && Math.abs(pct(r3.p, l1.p)) < 5 && r3.i > n - 45)
      out.push({ name: "Head & Shoulders", kind: "bearish", strength: 0.7, detail: "Distribution topping structure — a close under the neckline confirms it." });
  }
  if (lo.length >= 3) {
    const l1 = lo[lo.length - 3]!;
    const h2 = lo[lo.length - 2]!;
    const r3 = lo[lo.length - 1]!;
    if (h2.p < l1.p && h2.p < r3.p && Math.abs(pct(r3.p, l1.p)) < 5 && r3.i > n - 45)
      out.push({ name: "Inverse Head & Shoulders", kind: "bullish", strength: 0.7, detail: "Accumulation base — a breakout above the neckline confirms it." });
  }

  // --- Higher highs / higher lows structure
  if (hi.length >= 2 && lo.length >= 2) {
    const hh = last(hi).p > hi[hi.length - 2].p;
    const hl = last(lo).p > lo[lo.length - 2].p;
    if (hh && hl) out.push({ name: "Higher Highs & Higher Lows", kind: "bullish", strength: 0.7, detail: "Textbook uptrend market structure." });
    const lh = last(hi).p < hi[hi.length - 2].p;
    const ll = last(lo).p < lo[lo.length - 2].p;
    if (lh && ll) out.push({ name: "Lower Highs & Lower Lows", kind: "bearish", strength: 0.7, detail: "Downtrend structure — each rally is being sold." });
  }

  // --- Volatility squeeze / flag
  const wNow = last(bb.width);
  const wHist = bb.width.slice(-120).filter((x): x is number => x != null);
  if (wNow != null && wHist.length > 30 && wNow <= Math.min(...wHist) * 1.15)
    out.push({ name: "Bollinger Squeeze", kind: "neutral", strength: 0.55, detail: "Volatility has compressed to a multi-month low — an expansion move is usually imminent." });

  const run = pct(close[n - 1]!, close[Math.max(0, n - 30)]!);
  const pull = pct(close[n - 1]!, Math.max(...close.slice(-12)));
  if (run > 15 && pull > -8 && pull < -2)
    out.push({ name: "Bull Flag", kind: "bullish", strength: 0.65, detail: "Shallow orderly pullback after a sharp advance — continuation setup." });

  // --- Candlestick signals
  const a1 = c[n - 1]!;
  const a2 = c[n - 2]!;
  if (a1.c > a1.o && a2.c < a2.o && a1.c >= a2.o && a1.o <= a2.c)
    out.push({ name: "Bullish Engulfing", kind: "bullish", strength: 0.55, detail: "Today's up-candle fully engulfs yesterday's down-candle." });
  if (a1.c < a1.o && a2.c > a2.o && a1.o >= a2.c && a1.c <= a2.o)
    out.push({ name: "Bearish Engulfing", kind: "bearish", strength: 0.55, detail: "Sellers overwhelmed the prior up-candle." });
  const body = Math.abs(a1.c - a1.o);
  const lowerWick = Math.min(a1.c, a1.o) - a1.l;
  const upperWick = a1.h - Math.max(a1.c, a1.o);
  if (body > 0 && lowerWick > 2 * body && upperWick < body)
    out.push({ name: "Hammer", kind: "bullish", strength: 0.5, detail: "Long lower wick — intraday selling was absorbed." });
  if (body > 0 && upperWick > 2 * body && lowerWick < body)
    out.push({ name: "Shooting Star", kind: "bearish", strength: 0.5, detail: "Long upper wick — rallies are being distributed." });
  if (a1.o > a2.h * 1.02)
    out.push({ name: "Gap Up", kind: "bullish", strength: 0.45, detail: "Opened with a gap above yesterday's high — news-driven repricing." });
  if (a1.o < a2.l * 0.98)
    out.push({ name: "Gap Down", kind: "bearish", strength: 0.45, detail: "Opened below yesterday's low — negative repricing." });

  // --- Momentum extremes & divergence
  if (r != null && r > 70) out.push({ name: "RSI Overbought", kind: "bearish", strength: 0.4, detail: `RSI at ${r.toFixed(0)} — stretched, prone to mean reversion.` });
  if (r != null && r < 30) out.push({ name: "RSI Oversold", kind: "bullish", strength: 0.4, detail: `RSI at ${r.toFixed(0)} — washed out, bounce risk for shorts.` });
  const rs = rsi(close);
  if (lo.length >= 2) {
    const a = lo[lo.length - 2]!;
    const b = lo[lo.length - 1]!;
    const ra = rs[a.i]!;
    const rb = rs[b.i]!;
    if (ra != null && rb != null && b.p < a.p && rb > ra)
      out.push({ name: "Bullish RSI Divergence", kind: "bullish", strength: 0.65, detail: "Price made a lower low but momentum did not — selling pressure is fading." });
  }
  if (hi.length >= 2) {
    const a = hi[hi.length - 2]!;
    const b = hi[hi.length - 1]!;
    const ra = rs[a.i]!;
    const rb = rs[b.i]!;
    if (ra != null && rb != null && b.p > a.p && rb < ra)
      out.push({ name: "Bearish RSI Divergence", kind: "bearish", strength: 0.65, detail: "New price high on weaker momentum — rally is tiring." });
  }
  const mh = last(m.hist);
  const mhPrev = m.hist[n - 2]!;
  if (mh != null && mhPrev != null) {
    if (mh > 0 && mhPrev <= 0) out.push({ name: "MACD Bullish Crossover", kind: "bullish", strength: 0.6, detail: "MACD crossed above its signal line." });
    if (mh < 0 && mhPrev >= 0) out.push({ name: "MACD Bearish Crossover", kind: "bearish", strength: 0.6, detail: "MACD crossed below its signal line." });
  }

  return out;
}

export type TechSnapshot = {
  price: number;
  changePct1d: number;
  changePct5d: number;
  changePct20d: number;
  changePct60d: number;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  macdHist: number | null;
  atr: number | null;
  atrPct: number | null;
  volume: number;
  avgVolume20: number;
  high52: number;
  low52: number;
  support: number;
  resistance: number;
  patterns: Pattern[];
  score: number; // -100..100
  direction: "Bullish" | "Bearish" | "Neutral";
  confidence: number; // 0..100
};

export function analyseCandles(c: Candle[]): TechSnapshot {
  const close = c.map((x) => x.c);
  const n = c.length;
  const at = (k: number) => close[Math.max(0, n - 1 - k)]!;
  const patterns = detectPatterns(c);
  const bull = patterns.filter((p) => p.kind === "bullish").reduce((a, p) => a + p.strength, 0);
  const bear = patterns.filter((p) => p.kind === "bearish").reduce((a, p) => a + p.strength, 0);
  const r = last(rsi(close));
  const m = last(macd(close).hist);
  const s20 = last(sma(close, 20));
  const s50 = last(sma(close, 50));
  const s200 = n >= 200 ? last(sma(close, 200)) : null;
  const a = last(atr(c));
  const px = close[n - 1]!;

  let score = (bull - bear) * 18;
  if (r != null) score += (r - 50) * 0.5;
  if (m != null) score += Math.sign(m) * 6;
  if (s20 && px > s20) score += 6;
  if (s50 && px > s50) score += 6;
  if (s200 && px > s200) score += 6;
  score = Math.max(-100, Math.min(100, score));

  const window = c.slice(-60);
  const support = Math.min(...window.map((x) => x.l));
  const resistance = Math.max(...window.map((x) => x.h));
  const vol20 = c.slice(-20).reduce((s, x) => s + x.v, 0) / Math.min(20, n);

  const agreement = bull + bear > 0 ? Math.abs(bull - bear) / (bull + bear) : 0;
  const confidence = Math.round(Math.min(92, 35 + agreement * 40 + Math.min(Math.abs(score), 60) * 0.25));

  return {
    price: px,
    changePct1d: pct(px, at(1)),
    changePct5d: pct(px, at(5)),
    changePct20d: pct(px, at(20)),
    changePct60d: pct(px, at(60)),
    rsi: r ?? null,
    sma20: s20 ?? null,
    sma50: s50 ?? null,
    sma200: s200 ?? null,
    macdHist: m ?? null,
    atr: a ?? null,
    atrPct: a ? (a / px) * 100 : null,
    volume: last(c).v,
    avgVolume20: vol20,
    high52: Math.max(...c.slice(-250).map((x) => x.h)),
    low52: Math.min(...c.slice(-250).map((x) => x.l)),
    support,
    resistance,
    patterns,
    score: Math.round(score),
    direction: score > 12 ? "Bullish" : score < -12 ? "Bearish" : "Neutral",
    confidence,
  };
}
