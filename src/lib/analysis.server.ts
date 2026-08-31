/**
 * Orchestration layer: market data + pattern engine + ecosystem context + AI reasoning.
 *
 * ML backend integration
 * ──────────────────────
 * When the env var ML_BACKEND_URL is set (e.g. "http://localhost:8000"), every
 * call to runAnalysis() will fire a parallel request to POST /api/predict on
 * the Python FastAPI service.  The returned GBM score is blended (60 %) with
 * the TypeScript rule-based score (40 %) to produce the final blended score
 * used for position sizing and verdict.
 *
 * If ML_BACKEND_URL is not set, or the request fails, the system falls back
 * seamlessly to the TypeScript-only score — there is no hard dependency.
 */

import { analyseCandles, type Candle, type TechSnapshot } from "./indicators";
import { askAI, askAIJson } from "./ai.server";
import {
  fetchChart,
  fetchQuoteLite,
  fetchSearch,
  mapLimited,
  resolveSymbol,
  type NewsItem,
  type QuoteLite,
} from "./market.server";
import { computeSizing, RISK_RULES, type RiskProfile, type Sizing } from "./risk";
import { competitorsFor, SECTOR_DRIVERS, UNIVERSE, UNIVERSE_BY_SYMBOL, findInUniverse } from "./universe";

// ─── ML backend helpers ───────────────────────────────────────────────────────

type MLPrediction = {
  mlScore: number;
  mlConfidence: number;
  direction: string;
  trainedOn: number;
  featureImportances: Record<string, number>;
};

/**
 * Call the Python ML backend's /api/predict endpoint.
 * Returns null on any failure (network error, backend not running, etc.)
 * so the caller can degrade gracefully.
 */
async function fetchMLPrediction(
  symbol: string,
  profile: RiskProfile,
  horizon: string,
): Promise<MLPrediction | null> {
  const baseUrl = process.env["ML_BACKEND_URL"];
  if (!baseUrl) return null;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, capital: 100_000, profile, horizon }),
      signal: AbortSignal.timeout(8_000), // 8 s hard deadline
    });
    if (!res.ok) {
      console.warn(`[ml-backend] /api/predict returned ${res.status} for ${symbol}`);
      return null;
    }
    return (await res.json()) as MLPrediction;
  } catch (err) {
    console.warn(`[ml-backend] request failed for ${symbol}: ${String(err)}`);
    return null;
  }
}

/**
 * Blend the TypeScript rule-based score with the Python ML score.
 *   • 60 % ML  (GBM trained on 2 years of price history)
 *   • 40 % rule-based (pattern engine + feature-weighted score)
 * Falls back to 100 % rule-based when ml is null.
 */
function blendScores(
  ruleScore: number,
  ml: MLPrediction | null,
): { score: number; confidence: number; mlUsed: boolean } {
  if (!ml) return { score: ruleScore, confidence: 50, mlUsed: false };
  const blended = Math.max(-100, Math.min(100, Math.round(ml.mlScore * 0.6 + ruleScore * 0.4)));
  const confidence = Math.max(20, Math.min(92, Math.round(ml.mlConfidence * 0.6 + 40 * 0.4)));
  return { score: blended, confidence, mlUsed: true };
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type Peer = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  score: number;
  direction: string;
  rsi: number | null;
  topPattern: string | null;
};

export type AiVerdict = {
  thesis: string;
  rootCauses: { driver: string; type: string; impact: string; direction: "positive" | "negative" | "mixed" }[];
  patternRead: string;
  risks: string[];
  catalysts: string[];
  horizonView: string;
  aiScoreAdjustment: number;
};

export type Analysis = {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  price: number;
  snapshot: TechSnapshot;
  candles: Candle[];
  peers: Peer[];
  news: NewsItem[];
  drivers: { upstream: string[]; policy: string[] };
  sizing: Sizing;
  ai: AiVerdict;
  horizon: string;
  profile: RiskProfile;
  generatedAt: number;
  // ML metadata (only present when ML backend was used)
  ml?: {
    used: boolean;
    score: number;
    confidence: number;
    trainedOn: number;
    featureImportances: Record<string, number>;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function peerSummary(p: Peer[]) {
  return p.length
    ? p
        .map(
          (x) =>
            `${x.name} (${x.symbol}): ${x.changePct.toFixed(2)}% today, technical score ${x.score}, ${x.direction}${x.topPattern ? `, pattern: ${x.topPattern}` : ""}`,
        )
        .join("\n")
    : "No listed small-cap peers matched in the tracked universe.";
}

// ─── Core analysis ────────────────────────────────────────────────────────────

export async function runAnalysis(input: {
  query: string;
  capital: number;
  profile: RiskProfile;
  horizon: string;
}): Promise<Analysis> {
  // 1. Resolve symbol
  const local = findInUniverse(input.query);
  const hit = local
    ? { symbol: local.symbol, name: local.name, exchange: "NSE", sector: local.sector, industry: local.industry }
    : await resolveSymbol(input.query);
  if (!hit) throw new Error(`Could not find an NSE-listed equity for "${input.query}".`);

  // 2. Fetch price history + run TS pattern engine
  const chart = await fetchChart(hit.symbol, "2y", "1d");
  const snapshot = analyseCandles(chart.candles);

  const known = UNIVERSE_BY_SYMBOL.get(hit.symbol);
  const sector = known?.sector ?? hit.sector ?? "Other";
  const industry = known?.industry ?? hit.industry ?? sector;
  const drivers = SECTOR_DRIVERS[sector] ?? SECTOR_DRIVERS["Other"]!;

  // 3. Fire ML prediction + peer fetch + news search in parallel
  const peerEntries = competitorsFor(hit.symbol, known?.industry, sector);
  const [mlPred, peers, search] = await Promise.all([
    fetchMLPrediction(hit.symbol, input.profile, input.horizon),
    mapLimited(peerEntries, 2, async (p) => {
      try {
        const c = await fetchChart(p.symbol, "6mo", "1d");
        const s = analyseCandles(c.candles);
        const top = [...s.patterns].sort((a, b) => b.strength - a.strength)[0];
        return {
          symbol: p.symbol,
          name: p.name,
          price: c.price,
          changePct: ((c.price - c.previousClose) / c.previousClose) * 100,
          score: s.score,
          direction: s.direction,
          rsi: s.rsi,
          topPattern: top?.name ?? null,
        } as Peer;
      } catch {
        return null;
      }
    }),
    fetchSearch(hit.name).catch(() => ({ hits: [], news: [] as NewsItem[] })),
  ]);

  const cleanPeers = peers.filter((p): p is Peer => p !== null);

  // 4. Blend TS score with ML score
  const { score: blendedScore, confidence: blendedConf, mlUsed } = blendScores(snapshot.score, mlPred);

  // 5. Build AI prompt — include ML signal when available
  const patternText = snapshot.patterns
    .map((p) => `- ${p.name} [${p.kind}, weight ${p.strength}]: ${p.detail}`)
    .join("\n");

  const mlContext = mlPred
    ? `\nML MODEL (GBM, trained on ${mlPred.trainedOn} bars): score ${mlPred.mlScore}, confidence ${mlPred.mlConfidence}%, direction ${mlPred.direction}\nTop ML features: ${Object.entries(mlPred.featureImportances)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k, v]) => `${k}=${(v * 100).toFixed(1)}%`)
        .join(", ")}`
    : "\nML MODEL: not available (backend not running).";

  const extendedIndicators = [
    snapshot.stochK != null ? `Stoch %K ${snapshot.stochK.toFixed(1)} / %D ${snapshot.stochD?.toFixed(1)}` : null,
    snapshot.williamsR != null ? `Williams %R ${snapshot.williamsR.toFixed(1)}` : null,
    snapshot.adx != null
      ? `ADX ${snapshot.adx.toFixed(1)} (+DI ${snapshot.plusDI?.toFixed(1)} / -DI ${snapshot.minusDI?.toFixed(1)})`
      : null,
    snapshot.vwap != null ? `VWAP ₹${snapshot.vwap.toFixed(2)} (price ${snapshot.price > snapshot.vwap ? "above" : "below"})` : null,
    `OBV trend: ${snapshot.obvTrend}`,
    `Ichimoku: ${snapshot.ichimokuSignal}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const prompt = `Analyse this Indian NSE small-cap equity for a ${input.horizon} directional view.

COMPANY: ${hit.name} (${hit.symbol}) | Sector: ${sector} | Industry: ${industry}
PRICE: ₹${snapshot.price.toFixed(2)} | 1D ${snapshot.changePct1d.toFixed(2)}% | 5D ${snapshot.changePct5d.toFixed(2)}% | 20D ${snapshot.changePct20d.toFixed(2)}% | 60D ${snapshot.changePct60d.toFixed(2)}%
52W range: ₹${snapshot.low52.toFixed(2)} – ₹${snapshot.high52.toFixed(2)}
RSI ${snapshot.rsi?.toFixed(1)} | MACD hist ${snapshot.macdHist?.toFixed(3)} | ATR ${snapshot.atrPct?.toFixed(2)}% | Vol vs 20d avg ${(snapshot.volume / (snapshot.avgVolume20 || 1)).toFixed(2)}x
SMA20 ${snapshot.sma20?.toFixed(2)} | SMA50 ${snapshot.sma50?.toFixed(2)} | SMA200 ${snapshot.sma200?.toFixed(2) ?? "n/a"}
Extended: ${extendedIndicators}
Support ₹${snapshot.support.toFixed(2)} | Resistance ₹${snapshot.resistance.toFixed(2)}
Rule-based composite score: ${snapshot.score} → Blended score: ${blendedScore} (${blendedScore > 12 ? "Bullish" : blendedScore < -12 ? "Bearish" : "Neutral"}, confidence ${blendedConf}%)
${mlContext}

DETECTED CHART PATTERNS:
${patternText || "None significant."}

PEER / COMPETITOR TAPE:
${peerSummary(cleanPeers)}

UPSTREAM COST DRIVERS: ${drivers.upstream.join(", ")}
POLICY / MACRO TRIGGERS: ${drivers.policy.join(", ")}

RECENT HEADLINES:
${(search.news ?? []).slice(0, 6).map((n) => `- ${n.title} (${n.publisher})`).join("\n") || "- none retrieved"}

Return JSON only:
{
 "thesis": "3-4 sentence root-cause view of why the stock is likely to move the way it is, referencing the patterns, peers and cost/policy drivers",
 "rootCauses": [{"driver":"name","type":"upstream|competition|policy|demand|technical|sentiment","impact":"one sentence, concrete","direction":"positive|negative|mixed"}],
 "patternRead": "2-3 sentences interpreting the detected chart patterns together, including Ichimoku/ADX signals, and what would invalidate them",
 "risks": ["..."],
 "catalysts": ["..."],
 "horizonView": "what you expect over ${input.horizon}, with a rough % range",
 "aiScoreAdjustment": 0
}
aiScoreAdjustment is an integer from -20 to 20 adjusting the blended score for fundamentals/news/ecosystem context.`;

  const ai = await askAIJson<AiVerdict>(
    "You are a disciplined Indian small-cap equity analyst. You reason from root causes: raw-material and supply-chain costs, competitor moves and market-share shifts, government policy (PLI, FAME, tariffs) and rate cycles, plus chart-pattern and ML model evidence. You never guarantee returns. Respond with strict JSON only.",
    prompt,
    {
      thesis: "AI commentary is temporarily unavailable — the rule-based pattern engine and ML model output below are still valid.",
      rootCauses: [],
      patternRead: "",
      risks: [],
      catalysts: [],
      horizonView: "",
      aiScoreAdjustment: 0,
    },
  );

  // 6. Apply AI adjustment on top of already-blended score
  const adj = Math.max(-20, Math.min(20, Math.round(Number(ai.aiScoreAdjustment) || 0)));
  const finalScore = Math.max(-100, Math.min(100, blendedScore + adj));

  // 7. Position sizing
  const sizing = computeSizing({
    capital: input.capital,
    price: snapshot.price,
    atr: snapshot.atr,
    support: snapshot.support,
    resistance: snapshot.resistance,
    score: finalScore,
    confidence: blendedConf,
    profile: input.profile,
    avgVolume20: snapshot.avgVolume20,
  });

  return {
    symbol: hit.symbol,
    name: hit.name,
    exchange: chart.exchange,
    sector,
    industry,
    price: snapshot.price,
    snapshot: { ...snapshot, score: finalScore, confidence: blendedConf },
    candles: chart.candles.slice(-260),
    peers: cleanPeers,
    news: (search.news ?? []).slice(0, 8),
    drivers,
    sizing,
    ai: { ...ai, aiScoreAdjustment: adj },
    horizon: input.horizon,
    profile: input.profile,
    generatedAt: Date.now(),
    ml: mlPred
      ? {
          used: mlUsed,
          score: mlPred.mlScore,
          confidence: mlPred.mlConfidence,
          trainedOn: mlPred.trainedOn,
          featureImportances: mlPred.featureImportances,
        }
      : { used: false, score: 0, confidence: 0, trainedOn: 0, featureImportances: {} },
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardData = {
  movers: (QuoteLite & { sector: string })[];
  news: NewsItem[];
  sectors: { sector: string; avgChange: number; count: number }[];
  updatedAt: number;
};

export async function runDashboard(): Promise<DashboardData> {
  const picks = UNIVERSE.slice(0, 24);
  const quotes = await mapLimited(picks, 3, (u) =>
    fetchQuoteLite(u.symbol, u.name).then((q) => (q ? { ...q, sector: u.sector } : null)),
  );
  const movers = quotes.filter((q): q is QuoteLite & { sector: string } => q !== null);

  const bySector = new Map<string, number[]>();
  movers.forEach((m) => bySector.set(m.sector, [...(bySector.get(m.sector) ?? []), m.changePct]));
  const sectors = [...bySector.entries()]
    .map(([sector, v]) => ({ sector, avgChange: v.reduce((a, b) => a + b, 0) / v.length, count: v.length }))
    .sort((a, b) => b.avgChange - a.avgChange);

  const news = await fetchSearch("NSE small cap India stocks")
    .then((r) => r.news.slice(0, 8))
    .catch(() => [] as NewsItem[]);

  return { movers, news, sectors, updatedAt: Date.now() };
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function runSearch(query: string) {
  if (!query.trim()) return [];
  const { hits } = await fetchSearch(query).catch(() => ({ hits: [] }));
  return hits.filter((h) => h.symbol.endsWith(".NS") || h.symbol.endsWith(".BO")).slice(0, 8);
}

// ─── Agent chat ───────────────────────────────────────────────────────────────

export async function runAgentTurn(input: {
  messages: { role: "user" | "assistant"; content: string }[];
  capital: number;
  profile: RiskProfile;
  contextSymbol?: string | undefined;
}) {
  const rule = RISK_RULES[input.profile];
  const transcript = input.messages
    .slice(-10)
    .map((m) => `${m.role === "user" ? "Investor" : "Coach"}: ${m.content}`)
    .join("\n\n");

  const reply = await askAI(
    `You are an Indian equity investing coach specialised in NSE small-cap growth stocks under ₹300 (renewables, EMS/electronics, EV ancillaries, infra). You guide step by step: what to check, position sizing, stop-losses, staggered entries, portfolio limits and exit discipline.
Investor capital: ₹${input.capital.toLocaleString("en-IN")}. Risk profile: ${input.profile} (max ${(rule.riskPerTrade * 100).toFixed(0)}% capital at risk per trade, max ${(rule.maxExposure * 100).toFixed(0)}% in one position, target reward:risk ${rule.rr}:1).${input.contextSymbol ? ` Currently discussing ${input.contextSymbol}.` : ""}
Rules: equities only — never index, F&O or forex. Be concrete with numbers. Keep answers under 220 words, use short bullets. Always mention the stop-loss discipline when suggesting a buy. End with a one-line reminder that this is educational, not SEBI-registered advice.`,
    transcript,
  );
  return { reply };
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

export async function runQuotes(symbols: string[]) {
  const quotes = await mapLimited(symbols, 3, (s) =>
    fetchQuoteLite(s, UNIVERSE_BY_SYMBOL.get(s)?.name ?? s.replace(/\.(NS|BO)$/i, "")),
  );
  return quotes.filter((q): q is QuoteLite => q !== null);
}
