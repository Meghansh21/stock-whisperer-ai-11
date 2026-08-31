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

// ─────────────────────────────────────────────
//  Core indicator helpers
// ─────────────────────────────────────────────

export const sma = (v: number[], p: number): (number | null)[] =>
  v.map((_, i) => (i + 1 < p ? null : v.slice(i + 1 - p, i + 1).reduce((a, b) => a + b, 0) / p));

export function ema(v: number[], p: number): (number | null)[] {
  const k = 2 / (p + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  v.forEach((x, i) => {
    if (i + 1 < p) { out.push(null); return; }
    if (prev === null) prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
    else prev = x * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function rsi(v: number[], p = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i]! - v[i - 1]!;
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
    if (m == null) { upper.push(null); lower.push(null); width.push(null); return; }
    const w = v.slice(i + 1 - p, i + 1);
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / p);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
    width.push((2 * k * sd) / m);
  });
  return { mid, upper, lower, width };
}

/** Stochastic oscillator (%K and %D). */
export function stochastic(c: Candle[], kPeriod = 14, dPeriod = 3) {
  const kLine: (number | null)[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i + 1 < kPeriod) { kLine.push(null); continue; }
    const window = c.slice(i + 1 - kPeriod, i + 1);
    const lowestL = Math.min(...window.map((x) => x.l));
    const highestH = Math.max(...window.map((x) => x.h));
    const range = highestH - lowestL;
    kLine.push(range === 0 ? 50 : ((c[i]!.c - lowestL) / range) * 100);
  }
  const dLine = sma(kLine.map((x) => x ?? 0), dPeriod);
  return { k: kLine, d: dLine };
}

/** Williams %R */
export function williamsR(c: Candle[], period = 14): (number | null)[] {
  return c.map((_, i) => {
    if (i + 1 < period) return null;
    const window = c.slice(i + 1 - period, i + 1);
    const hi = Math.max(...window.map((x) => x.h));
    const lo = Math.min(...window.map((x) => x.l));
    const range = hi - lo;
    return range === 0 ? -50 : ((hi - c[i]!.c) / range) * -100;
  });
}

/** On-Balance Volume */
export function obv(c: Candle[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    const prev = out[i - 1]!;
    if (c[i]!.c > c[i - 1]!.c) out.push(prev + c[i]!.v);
    else if (c[i]!.c < c[i - 1]!.c) out.push(prev - c[i]!.v);
    else out.push(prev);
  }
  return out;
}

/** Volume-Weighted Average Price (rolling 20-day). */
export function vwap(c: Candle[], period = 20): (number | null)[] {
  return c.map((_, i) => {
    if (i + 1 < period) return null;
    const window = c.slice(i + 1 - period, i + 1);
    const totalVol = window.reduce((a, x) => a + x.v, 0);
    if (totalVol === 0) return null;
    const totalPV = window.reduce((a, x) => a + ((x.h + x.l + x.c) / 3) * x.v, 0);
    return totalPV / totalVol;
  });
}

/** Ichimoku Cloud components (simplified daily). */
export function ichimoku(c: Candle[]) {
  const tenkan: (number | null)[] = [];
  const kijun: (number | null)[] = [];
  const senkouA: (number | null)[] = [];
  const senkouB: (number | null)[] = [];
  const chikou: (number | null)[] = [];

  for (let i = 0; i < c.length; i++) {
    // Tenkan-sen (9)
    if (i + 1 < 9) { tenkan.push(null); }
    else {
      const w = c.slice(i + 1 - 9, i + 1);
      tenkan.push((Math.max(...w.map((x) => x.h)) + Math.min(...w.map((x) => x.l))) / 2);
    }
    // Kijun-sen (26)
    if (i + 1 < 26) { kijun.push(null); }
    else {
      const w = c.slice(i + 1 - 26, i + 1);
      kijun.push((Math.max(...w.map((x) => x.h)) + Math.min(...w.map((x) => x.l))) / 2);
    }
    // Senkou A = (tenkan + kijun) / 2, projected 26 forward
    const t = tenkan[i], k = kijun[i];
    senkouA.push(t != null && k != null ? (t + k) / 2 : null);
    // Senkou B (52)
    if (i + 1 < 52) { senkouB.push(null); }
    else {
      const w = c.slice(i + 1 - 52, i + 1);
      senkouB.push((Math.max(...w.map((x) => x.h)) + Math.min(...w.map((x) => x.l))) / 2);
    }
    // Chikou span = close lagged 26
    chikou.push(i >= 26 ? c[i - 26]!.c : null);
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/** Average Directional Index (ADX) — trend strength. */
export function adx(c: Candle[], period = 14): { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] } {
  const trArr: number[] = c.map((x, i) =>
    i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c)),
  );
  const plusDMArr: number[] = c.map((x, i) => {
    if (i === 0) return 0;
    const upMove = x.h - c[i - 1]!.h;
    const downMove = c[i - 1]!.l - x.l;
    return upMove > downMove && upMove > 0 ? upMove : 0;
  });
  const minusDMArr: number[] = c.map((x, i) => {
    if (i === 0) return 0;
    const upMove = x.h - c[i - 1]!.h;
    const downMove = c[i - 1]!.l - x.l;
    return downMove > upMove && downMove > 0 ? downMove : 0;
  });

  const smoothTR = sma(trArr, period);
  const smoothPlusDM = sma(plusDMArr, period);
  const smoothMinusDM = sma(minusDMArr, period);

  const plusDI: (number | null)[] = smoothTR.map((tr, i) =>
    tr && smoothPlusDM[i] != null ? (smoothPlusDM[i]! / tr) * 100 : null,
  );
  const minusDI: (number | null)[] = smoothTR.map((tr, i) =>
    tr && smoothMinusDM[i] != null ? (smoothMinusDM[i]! / tr) * 100 : null,
  );

  const dx: (number | null)[] = plusDI.map((p, i) => {
    const m = minusDI[i];
    if (p == null || m == null) return null;
    const sum = p + m;
    return sum === 0 ? 0 : (Math.abs(p - m) / sum) * 100;
  });
  const adxLine = sma(dx.map((x) => x ?? 0), period);
  return { adx: adxLine, plusDI, minusDI };
}

// ─────────────────────────────────────────────
//  Pivot discovery
// ─────────────────────────────────────────────

const last = <T,>(a: T[]) => a[a.length - 1] as T;
const pct = (a: number, b: number) => ((a - b) / b) * 100;

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

// ─────────────────────────────────────────────
//  Pattern detection
// ─────────────────────────────────────────────

/** Comprehensive chart + candlestick pattern detection on daily candles. */
export function detectPatterns(c: Candle[]): Pattern[] {
  const out: Pattern[] = [];
  if (c.length < 40) return out;

  const close = c.map((x) => x.c);
  const open = c.map((x) => x.o);
  const high = c.map((x) => x.h);
  const low = c.map((x) => x.l);
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
  const stoch = stochastic(c);
  const wr = williamsR(c);
  const obvArr = obv(c);
  const vwapArr = vwap(c);
  const ichi = ichimoku(c);
  const adxResult = adx(c);

  // ── Moving-average structure ──────────────────
  if (s20 && s50 && prev20 && prev50) {
    if (s20 > s50 && prev20 <= prev50)
      out.push({ name: "Golden Cross (20/50)", kind: "bullish", strength: 0.75, detail: "Short-term average just crossed above the medium-term — classic trend-start signal." });
    if (s20 < s50 && prev20 >= prev50)
      out.push({ name: "Death Cross (20/50)", kind: "bearish", strength: 0.75, detail: "Short-term average cut below the medium-term — momentum is rolling over." });
  }
  if (s200 && px > s200 && s50 && s50 > s200)
    out.push({ name: "Primary Uptrend", kind: "bullish", strength: 0.6, detail: "Price and 50-DMA are both above the 200-DMA." });
  if (s200 && px < s200)
    out.push({ name: "Below 200-DMA", kind: "bearish", strength: 0.5, detail: "Trading under the long-term trend line — institutional demand is weak." });

  // ── Breakout / breakdown ──────────────────────
  const hi20 = Math.max(...c.slice(-21, -1).map((x) => x.h));
  const lo20 = Math.min(...c.slice(-21, -1).map((x) => x.l));
  if (px > hi20)
    out.push({ name: "20-Day Range Breakout", kind: "bullish", strength: 0.8, detail: `Closed above the prior 20-day high of ₹${hi20.toFixed(2)}.` });
  if (px < lo20)
    out.push({ name: "20-Day Breakdown", kind: "bearish", strength: 0.8, detail: `Closed below the prior 20-day low of ₹${lo20.toFixed(2)}.` });

  // ── Volume signals ────────────────────────────
  if (last(vol) > 2 * avgVol20)
    out.push({
      name: "Volume Spike",
      kind: close[n - 1]! > close[n - 2]! ? "bullish" : "bearish",
      strength: 0.65,
      detail: `Traded ${(last(vol) / avgVol20).toFixed(1)}x the 20-day average volume — institutional footprint.`,
    });
  if (last(vol) < 0.5 * avgVol20 && px > (s20 ?? px))
    out.push({ name: "Low-Volume Drift", kind: "neutral", strength: 0.3, detail: "Advance is not backed by volume; treat the move as fragile." });

  // ── OBV trend ─────────────────────────────────
  const obvSma20 = last(sma(obvArr, 20));
  const obvNow = last(obvArr);
  if (obvSma20 != null && obvNow > obvSma20 * 1.05 && px > (s20 ?? px))
    out.push({ name: "OBV Confirms Rally", kind: "bullish", strength: 0.55, detail: "On-balance volume is trending above its 20-day average — institutional accumulation visible." });
  if (obvSma20 != null && obvNow < obvSma20 * 0.95 && px < (s20 ?? px))
    out.push({ name: "OBV Distribution", kind: "bearish", strength: 0.55, detail: "OBV is falling below its average while price declines — distribution phase." });

  // ── VWAP signals ──────────────────────────────
  const vwapNow = last(vwapArr);
  if (vwapNow != null) {
    if (px > vwapNow * 1.02)
      out.push({ name: "Above VWAP", kind: "bullish", strength: 0.4, detail: `Price (₹${px.toFixed(2)}) is trading ${((px / vwapNow - 1) * 100).toFixed(1)}% above VWAP — buyers in control.` });
    if (px < vwapNow * 0.98)
      out.push({ name: "Below VWAP", kind: "bearish", strength: 0.4, detail: `Price is trading below VWAP — sellers have the edge intraday.` });
  }

  // ── Ichimoku Cloud ────────────────────────────
  const tenkanNow = last(ichi.tenkan);
  const kijunNow = last(ichi.kijun);
  const senkouANow = last(ichi.senkouA);
  const senkouBNow = last(ichi.senkouB);
  if (tenkanNow != null && kijunNow != null && senkouANow != null && senkouBNow != null) {
    const cloudTop = Math.max(senkouANow, senkouBNow);
    const cloudBot = Math.min(senkouANow, senkouBNow);
    if (px > cloudTop && tenkanNow > kijunNow)
      out.push({ name: "Ichimoku Bullish", kind: "bullish", strength: 0.7, detail: "Price is above a bullish cloud with Tenkan above Kijun — strong uptrend confirmation." });
    if (px < cloudBot && tenkanNow < kijunNow)
      out.push({ name: "Ichimoku Bearish", kind: "bearish", strength: 0.7, detail: "Price is below a bearish cloud with Tenkan below Kijun — strong downtrend confirmation." });
    if (px > cloudBot && px < cloudTop)
      out.push({ name: "Ichimoku Cloud Chop", kind: "neutral", strength: 0.3, detail: "Price is inside the Ichimoku cloud — indecision, avoid large positions." });
  }

  // ── ADX trend strength ────────────────────────
  const adxNow = last(adxResult.adx);
  const plusDINow = last(adxResult.plusDI);
  const minusDINow = last(adxResult.minusDI);
  if (adxNow != null && adxNow > 25 && plusDINow != null && minusDINow != null) {
    if (plusDINow > minusDINow)
      out.push({ name: "Strong Bullish Trend (ADX)", kind: "bullish", strength: 0.65, detail: `ADX at ${adxNow.toFixed(0)} confirms a strong trending move upward (+DI leads).` });
    else
      out.push({ name: "Strong Bearish Trend (ADX)", kind: "bearish", strength: 0.65, detail: `ADX at ${adxNow.toFixed(0)} confirms a strong trending move downward (-DI leads).` });
  }

  // ── Stochastic signals ────────────────────────
  const kNow = last(stoch.k);
  const dNow = last(stoch.d);
  const kPrev = stoch.k[n - 2];
  const dPrev = stoch.d[n - 2];
  if (kNow != null && dNow != null && kPrev != null && dPrev != null) {
    if (kNow > dNow && kPrev! <= dPrev! && kNow < 40)
      out.push({ name: "Stochastic Bullish Cross (Oversold)", kind: "bullish", strength: 0.6, detail: "%K just crossed above %D in oversold zone — high-probability reversal signal." });
    if (kNow < dNow && kPrev! >= dPrev! && kNow > 60)
      out.push({ name: "Stochastic Bearish Cross (Overbought)", kind: "bearish", strength: 0.6, detail: "%K crossed below %D in overbought zone — momentum reversal." });
  }

  // ── Williams %R ───────────────────────────────
  const wrNow = last(wr);
  if (wrNow != null) {
    if (wrNow > -20)
      out.push({ name: "Williams %R Overbought", kind: "bearish", strength: 0.45, detail: `Williams %R at ${wrNow.toFixed(0)} — deeply overbought, pullback risk elevated.` });
    if (wrNow < -80)
      out.push({ name: "Williams %R Oversold", kind: "bullish", strength: 0.45, detail: `Williams %R at ${wrNow.toFixed(0)} — deeply oversold, watch for a bounce.` });
  }

  // ── Double bottom / double top ────────────────
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
      out.push({ name: "Double Top", kind: "bearish", strength: 0.8, detail: `Rejected twice near ₹${a.p.toFixed(2)} and lost the neckline.` });
  }

  // ── Head & shoulders ──────────────────────────
  if (hi.length >= 3) {
    const l1 = hi[hi.length - 3]!;
    const h2 = hi[hi.length - 2]!;
    const r3 = hi[hi.length - 1]!;
    if (h2.p > l1.p && h2.p > r3.p && Math.abs(pct(r3.p, l1.p)) < 5 && r3.i > n - 45)
      out.push({ name: "Head & Shoulders", kind: "bearish", strength: 0.7, detail: "Distribution topping structure — a close under the neckline confirms." });
  }
  if (lo.length >= 3) {
    const l1 = lo[lo.length - 3]!;
    const h2 = lo[lo.length - 2]!;
    const r3 = lo[lo.length - 1]!;
    if (h2.p < l1.p && h2.p < r3.p && Math.abs(pct(r3.p, l1.p)) < 5 && r3.i > n - 45)
      out.push({ name: "Inverse Head & Shoulders", kind: "bullish", strength: 0.7, detail: "Accumulation base — a breakout above the neckline confirms." });
  }

  // ── Cup & Handle ──────────────────────────────
  if (c.length >= 65) {
    const window = close.slice(-65);
    const leftRim = window[0]!;
    const base = Math.min(...window.slice(5, 55));
    const rightRim = Math.max(...window.slice(55, 65));
    const depth = (leftRim - base) / leftRim;
    if (depth > 0.12 && depth < 0.5 && rightRim >= leftRim * 0.97 && px > rightRim * 0.97) {
      const handlePull = (rightRim - px) / rightRim;
      if (handlePull >= 0 && handlePull < 0.12)
        out.push({ name: "Cup & Handle", kind: "bullish", strength: 0.78, detail: `U-shaped base ${(depth * 100).toFixed(0)}% deep with handle forming near the rim at ₹${rightRim.toFixed(2)} — breakout setup.` });
    }
  }

  // ── Rounding Bottom ───────────────────────────
  if (c.length >= 60) {
    const seg = close.slice(-60);
    const lows = [
      Math.min(...seg.slice(0, 15)),
      Math.min(...seg.slice(15, 30)),
      Math.min(...seg.slice(30, 45)),
      Math.min(...seg.slice(45)),
    ];
    if (lows[0]! > lows[1]! && lows[1]! > lows[2]! - (lows[1]! * 0.01) && lows[2]! < lows[3]! && lows[3]! > lows[0]! * 0.98)
      out.push({ name: "Rounding Bottom", kind: "bullish", strength: 0.65, detail: "Gradual saucer-shaped recovery — patient institutional accumulation over 60 sessions." });
  }

  // ── Rising & Falling Wedge ────────────────────
  if (hi.length >= 4 && lo.length >= 4) {
    const recentHi = hi.slice(-4);
    const recentLo = lo.slice(-4);
    const hiSlope = (recentHi[3]!.p - recentHi[0]!.p) / (recentHi[3]!.i - recentHi[0]!.i);
    const loSlope = (recentLo[3]!.p - recentLo[0]!.p) / (recentLo[3]!.i - recentLo[0]!.i);
    if (hiSlope > 0 && loSlope > 0 && loSlope > hiSlope * 1.3)
      out.push({ name: "Rising Wedge", kind: "bearish", strength: 0.68, detail: "Support rising faster than resistance — narrowing range signals exhaustion; watch for a breakdown." });
    if (hiSlope < 0 && loSlope < 0 && hiSlope > loSlope * 1.3)
      out.push({ name: "Falling Wedge", kind: "bullish", strength: 0.68, detail: "Resistance falling faster than support — compression before a bullish breakout." });
  }

  // ── Symmetric Triangle ────────────────────────
  if (hi.length >= 3 && lo.length >= 3) {
    const rh = hi.slice(-3);
    const rl = lo.slice(-3);
    const hiSlope = (rh[2]!.p - rh[0]!.p) / Math.max(1, rh[2]!.i - rh[0]!.i);
    const loSlope = (rl[2]!.p - rl[0]!.p) / Math.max(1, rl[2]!.i - rl[0]!.i);
    if (hiSlope < -0.02 && loSlope > 0.02 && Math.abs(hiSlope + loSlope) < Math.abs(hiSlope) * 0.5)
      out.push({ name: "Symmetric Triangle", kind: "neutral", strength: 0.5, detail: "Price coiling between converging trendlines — breakout direction will set the next move." });
  }

  // ── Ascending & Descending Triangle ──────────
  if (hi.length >= 3 && lo.length >= 3) {
    const rh = hi.slice(-3);
    const rl = lo.slice(-3);
    const hiFlat = Math.abs(pct(rh[2]!.p, rh[0]!.p)) < 1.5;
    const loRising = (rl[2]!.p - rl[0]!.p) / Math.max(1, rl[2]!.i - rl[0]!.i) > 0.03;
    if (hiFlat && loRising)
      out.push({ name: "Ascending Triangle", kind: "bullish", strength: 0.7, detail: `Resistance flat near ₹${rh[2]!.p.toFixed(2)} with rising support — bullish continuation; watch for volume breakout.` });
    const loFlat = Math.abs(pct(rl[2]!.p, rl[0]!.p)) < 1.5;
    const hiFalling = (rh[2]!.p - rh[0]!.p) / Math.max(1, rh[2]!.i - rh[0]!.i) < -0.03;
    if (loFlat && hiFalling)
      out.push({ name: "Descending Triangle", kind: "bearish", strength: 0.7, detail: `Support flat near ₹${rl[2]!.p.toFixed(2)} with falling resistance — bearish continuation; breakdown likely.` });
  }

  // ── Three White Soldiers / Three Black Crows ──
  const a1 = c[n - 1]!, a2 = c[n - 2]!, a3 = c[n - 3]!;
  const isWhite = (x: Candle) => x.c > x.o && (x.c - x.o) / (x.h - x.l + 1e-9) > 0.5;
  const isBlack = (x: Candle) => x.o > x.c && (x.o - x.c) / (x.h - x.l + 1e-9) > 0.5;
  if (isWhite(a1) && isWhite(a2) && isWhite(a3) && a1.o > a2.o && a2.o > a3.o)
    out.push({ name: "Three White Soldiers", kind: "bullish", strength: 0.72, detail: "Three consecutive strong up-candles opening inside the prior body — powerful accumulation." });
  if (isBlack(a1) && isBlack(a2) && isBlack(a3) && a1.o < a2.o && a2.o < a3.o)
    out.push({ name: "Three Black Crows", kind: "bearish", strength: 0.72, detail: "Three consecutive strong down-candles — distribution pattern, selling pressure is persistent." });

  // ── Morning Star / Evening Star ───────────────
  if (c.length >= 3) {
    const s1 = c[n - 3]!, s2 = c[n - 2]!, s3 = c[n - 1]!;
    const body1 = Math.abs(s1.c - s1.o);
    const body3 = Math.abs(s3.c - s3.o);
    if (s1.c < s1.o && body1 > 0.6 * (s1.h - s1.l) &&
        Math.abs(s2.c - s2.o) < body1 * 0.3 && s2.h < s1.c &&
        s3.c > s3.o && s3.c > (s1.c + s1.o) / 2)
      out.push({ name: "Morning Star", kind: "bullish", strength: 0.75, detail: "Three-candle reversal: big red, small star, big green. Buyers took control at the low." });
    if (s1.c > s1.o && body1 > 0.6 * (s1.h - s1.l) &&
        Math.abs(s2.c - s2.o) < body1 * 0.3 && s2.l > s1.c &&
        s3.c < s3.o && s3.c < (s1.c + s1.o) / 2)
      out.push({ name: "Evening Star", kind: "bearish", strength: 0.75, detail: "Three-candle topping pattern: big green, small star, big red. Sellers took control at the high." });
  }

  // ── HH/HL & LH/LL structure ───────────────────
  if (hi.length >= 2 && lo.length >= 2) {
    const hh = last(hi).p > hi[hi.length - 2]!.p;
    const hl = last(lo).p > lo[lo.length - 2]!.p;
    if (hh && hl) out.push({ name: "Higher Highs & Higher Lows", kind: "bullish", strength: 0.7, detail: "Textbook uptrend market structure." });
    const lh = last(hi).p < hi[hi.length - 2]!.p;
    const ll = last(lo).p < lo[lo.length - 2]!.p;
    if (lh && ll) out.push({ name: "Lower Highs & Lower Lows", kind: "bearish", strength: 0.7, detail: "Downtrend structure — each rally is being sold." });
  }

  // ── Bollinger Squeeze ─────────────────────────
  const wNow = last(bb.width);
  const wHist = bb.width.slice(-120).filter((x): x is number => x != null);
  if (wNow != null && wHist.length > 30 && wNow <= Math.min(...wHist) * 1.15)
    out.push({ name: "Bollinger Squeeze", kind: "neutral", strength: 0.55, detail: "Volatility compressed to a multi-month low — an expansion move is imminent." });

  // ── Bull / Bear Flag ──────────────────────────
  const run = pct(close[n - 1]!, close[Math.max(0, n - 30)]!);
  const pull = pct(close[n - 1]!, Math.max(...close.slice(-12)));
  if (run > 15 && pull > -8 && pull < -2)
    out.push({ name: "Bull Flag", kind: "bullish", strength: 0.65, detail: "Shallow pullback after a sharp advance — continuation setup." });
  if (run < -15 && pct(close[n - 1]!, Math.min(...close.slice(-12))) < 8 && pct(close[n - 1]!, Math.min(...close.slice(-12))) > 2)
    out.push({ name: "Bear Flag", kind: "bearish", strength: 0.65, detail: "Shallow bounce after a sharp decline — continuation to the downside." });

  // ── Single candlestick ────────────────────────
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

  // Doji
  const totalRange = a1.h - a1.l;
  if (totalRange > 0 && body / totalRange < 0.1)
    out.push({ name: "Doji", kind: "neutral", strength: 0.35, detail: "Open ≈ Close — market indecision; the next candle's direction is key." });

  if (a1.o > a2.h * 1.02)
    out.push({ name: "Gap Up", kind: "bullish", strength: 0.45, detail: "Opened with a gap above yesterday's high — news-driven repricing." });
  if (a1.o < a2.l * 0.98)
    out.push({ name: "Gap Down", kind: "bearish", strength: 0.45, detail: "Opened below yesterday's low — negative repricing." });

  // ── Momentum extremes & divergence ────────────
  if (r != null && r > 70) out.push({ name: "RSI Overbought", kind: "bearish", strength: 0.4, detail: `RSI at ${r.toFixed(0)} — stretched, prone to mean reversion.` });
  if (r != null && r < 30) out.push({ name: "RSI Oversold", kind: "bullish", strength: 0.4, detail: `RSI at ${r.toFixed(0)} — washed out, bounce risk for shorts.` });

  const rs = rsi(close);
  if (lo.length >= 2) {
    const a = lo[lo.length - 2]!;
    const b = lo[lo.length - 1]!;
    const ra = rs[a.i]!, rb = rs[b.i]!;
    if (ra != null && rb != null && b.p < a.p && rb > ra)
      out.push({ name: "Bullish RSI Divergence", kind: "bullish", strength: 0.65, detail: "Price made a lower low but momentum did not — selling pressure is fading." });
  }
  if (hi.length >= 2) {
    const a = hi[hi.length - 2]!;
    const b = hi[hi.length - 1]!;
    const ra = rs[a.i]!, rb = rs[b.i]!;
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

// ─────────────────────────────────────────────
//  XGBoost-inspired multi-factor scoring
// ─────────────────────────────────────────────

/**
 * Feature vector for the scoring model.
 * All values are normalised to [-1, 1] before weighting.
 */
function buildFeatureVector(c: Candle[], close: number[], n: number, px: number) {
  const s20 = last(sma(close, 20));
  const s50 = last(sma(close, 50));
  const s200 = n >= 200 ? last(sma(close, 200)) : null;
  const r = last(rsi(close));
  const m = last(macd(close).hist);
  const at = last(atr(c));
  const stoch = stochastic(c);
  const kNow = last(stoch.k);
  const wr = last(williamsR(c));
  const obvArr = obv(c);
  const obvSma20 = last(sma(obvArr, 20));
  const obvNow = last(obvArr);
  const vwapNow = last(vwap(c));
  const adxResult = adx(c);
  const adxNow = last(adxResult.adx);
  const plusDINow = last(adxResult.plusDI);
  const minusDINow = last(adxResult.minusDI);
  const ichi = ichimoku(c);
  const tenkan = last(ichi.tenkan);
  const kijun = last(ichi.kijun);
  const senkouA = last(ichi.senkouA);
  const senkouB = last(ichi.senkouB);

  // Normalisation helpers
  const norm = (v: number, min: number, max: number) =>
    max === min ? 0 : Math.max(-1, Math.min(1, (2 * (v - min)) / (max - min) - 1));
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  // RSI: 0-100 → [-1,1], oversold negative, overbought positive
  const f_rsi = r != null ? clamp((r - 50) / 50) : 0;
  // MACD hist sign & magnitude
  const f_macd = m != null ? clamp(m / (at ?? 1)) : 0;
  // Price vs SMAs
  const f_sma20 = s20 ? clamp((px - s20) / s20) * 5 : 0;
  const f_sma50 = s50 ? clamp((px - s50) / s50) * 5 : 0;
  const f_sma200 = s200 ? clamp((px - s200) / s200) * 5 : 0;
  // Stochastic: 0-100 → [-1,1]
  const f_stoch = kNow != null ? clamp((kNow - 50) / 50) : 0;
  // Williams %R: -100 to 0 → [-1,1]
  const f_wr = wr != null ? clamp((wr + 50) / 50) : 0;
  // OBV trend
  const f_obv = (obvSma20 != null && obvNow != 0) ? clamp((obvNow - obvSma20) / (Math.abs(obvSma20) + 1)) : 0;
  // VWAP
  const f_vwap = vwapNow ? clamp((px - vwapNow) / vwapNow * 20) : 0;
  // ADX direction
  const f_adx = (adxNow != null && plusDINow != null && minusDINow != null)
    ? clamp(((adxNow > 20 ? 1 : 0.4) * (plusDINow - minusDINow)) / 50) : 0;
  // Ichimoku
  let f_ichi = 0;
  if (tenkan != null && kijun != null && senkouA != null && senkouB != null) {
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBot = Math.min(senkouA, senkouB);
    if (px > cloudTop && tenkan > kijun) f_ichi = 1;
    else if (px < cloudBot && tenkan < kijun) f_ichi = -1;
    else if (px > cloudTop) f_ichi = 0.5;
    else if (px < cloudBot) f_ichi = -0.5;
  }
  // Momentum: 60-day return normalised
  const at60 = close[Math.max(0, n - 61)]!;
  const f_mom60 = clamp((px - at60) / (at60 + 1e-9) * 3);
  // Volume vs avg
  const vol = c.map((x) => x.v);
  const avgVol20 = vol.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const f_vol = clamp((last(vol) / (avgVol20 + 1) - 1));

  return {
    f_rsi, f_macd, f_sma20, f_sma50, f_sma200,
    f_stoch, f_wr, f_obv, f_vwap, f_adx,
    f_ichi, f_mom60, f_vol,
  };
}

/**
 * XGBoost-inspired feature weights (learned from domain knowledge of
 * NSE small-cap equity patterns; approximate feature importances).
 */
const FEATURE_WEIGHTS = {
  f_rsi:    0.10,
  f_macd:   0.09,
  f_sma20:  0.11,
  f_sma50:  0.10,
  f_sma200: 0.08,
  f_stoch:  0.07,
  f_wr:     0.05,
  f_obv:    0.09,
  f_vwap:   0.06,
  f_adx:    0.10,
  f_ichi:   0.09,
  f_mom60:  0.11,
  f_vol:    0.05,
} as const;

// ─────────────────────────────────────────────
//  TechSnapshot
// ─────────────────────────────────────────────

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
  score: number;       // -100..100
  direction: "Bullish" | "Bearish" | "Neutral";
  confidence: number;  // 0..100
  // Extended indicators for UI / API
  stochK: number | null;
  stochD: number | null;
  williamsR: number | null;
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  obvTrend: "up" | "down" | "flat";
  vwap: number | null;
  ichimokuSignal: "bullish" | "bearish" | "neutral";
  featureScores: Record<string, number>;
};

export function analyseCandles(c: Candle[]): TechSnapshot {
  const close = c.map((x) => x.c);
  const n = c.length;
  const at = (k: number) => close[Math.max(0, n - 1 - k)]!;

  const patterns = detectPatterns(c);

  // ── Blended score: pattern engine + feature vector ──
  const bull = patterns.filter((p) => p.kind === "bullish").reduce((a, p) => a + p.strength, 0);
  const bear = patterns.filter((p) => p.kind === "bearish").reduce((a, p) => a + p.strength, 0);
  const patternContrib = (bull - bear) * 14; // pattern signal

  const px = close[n - 1]!;
  const fv = buildFeatureVector(c, close, n, px);
  const featureScore = Object.entries(FEATURE_WEIGHTS).reduce(
    (sum, [k, w]) => sum + (fv[k as keyof typeof fv] ?? 0) * w * 100,
    0,
  );

  // Weighted blend: 55% feature model + 45% pattern engine
  const rawScore = featureScore * 0.55 + patternContrib * 0.45;
  const score = Math.max(-100, Math.min(100, Math.round(rawScore)));

  // ── Confidence via feature agreement ──────────
  const featureValues = Object.values(fv);
  const bullFeatures = featureValues.filter((x) => x > 0.1).length;
  const bearFeatures = featureValues.filter((x) => x < -0.1).length;
  const totalFeatures = featureValues.length;
  const agreement = totalFeatures > 0 ? Math.abs(bullFeatures - bearFeatures) / totalFeatures : 0;
  const patternAgreement = bull + bear > 0 ? Math.abs(bull - bear) / (bull + bear) : 0;
  const blendedAgreement = agreement * 0.6 + patternAgreement * 0.4;
  const confidence = Math.round(Math.min(92, 30 + blendedAgreement * 45 + Math.min(Math.abs(score), 60) * 0.28));

  // ── Support / resistance ───────────────────────
  const window60 = c.slice(-60);
  const support = Math.min(...window60.map((x) => x.l));
  const resistance = Math.max(...window60.map((x) => x.h));
  const vol20 = c.slice(-20).reduce((s, x) => s + x.v, 0) / Math.min(20, n);

  // ── Extended indicator values ──────────────────
  const stochResult = stochastic(c);
  const kNow = last(stochResult.k);
  const dNow = last(stochResult.d);
  const wrNow = last(williamsR(c));
  const adxResult = adx(c);
  const adxNow = last(adxResult.adx);
  const plusDINow = last(adxResult.plusDI);
  const minusDINow = last(adxResult.minusDI);
  const obvArr = obv(c);
  const obvSma = last(sma(obvArr, 10));
  const obvNow = last(obvArr);
  const vwapNow = last(vwap(c));
  const ichi = ichimoku(c);
  const tenkan = last(ichi.tenkan);
  const kijun = last(ichi.kijun);
  const senkouA = last(ichi.senkouA);
  const senkouB = last(ichi.senkouB);
  let ichimokuSignal: "bullish" | "bearish" | "neutral" = "neutral";
  if (tenkan != null && kijun != null && senkouA != null && senkouB != null) {
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBot = Math.min(senkouA, senkouB);
    if (px > cloudTop && tenkan > kijun) ichimokuSignal = "bullish";
    else if (px < cloudBot && tenkan < kijun) ichimokuSignal = "bearish";
  }
  const obvTrend: "up" | "down" | "flat" =
    obvSma != null ? (obvNow > obvSma * 1.01 ? "up" : obvNow < obvSma * 0.99 ? "down" : "flat") : "flat";

  const r = last(rsi(close));
  const m = last(macd(close).hist);
  const s20 = last(sma(close, 20));
  const s50 = last(sma(close, 50));
  const s200 = n >= 200 ? last(sma(close, 200)) : null;
  const a = last(atr(c));

  const featureScores: Record<string, number> = {};
  Object.entries(fv).forEach(([k, v]) => {
    featureScores[k] = Math.round((fv[k as keyof typeof fv] ?? 0) * (FEATURE_WEIGHTS[k as keyof typeof FEATURE_WEIGHTS] ?? 0) * 100);
  });

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
    score,
    direction: score > 12 ? "Bullish" : score < -12 ? "Bearish" : "Neutral",
    confidence,
    stochK: kNow ?? null,
    stochD: dNow ?? null,
    williamsR: wrNow ?? null,
    adx: adxNow ?? null,
    plusDI: plusDINow ?? null,
    minusDI: minusDINow ?? null,
    obvTrend,
    vwap: vwapNow ?? null,
    ichimokuSignal,
    featureScores,
  };
}
