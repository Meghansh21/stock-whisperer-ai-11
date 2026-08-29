// Orchestration layer: market data + pattern engine + ecosystem context + AI reasoning.
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
};

function peerSummary(p: Peer[]) {
  return p.length
    ? p.map((x) => `${x.name} (${x.symbol}): ${x.changePct.toFixed(2)}% today, technical score ${x.score}, ${x.direction}${x.topPattern ? `, pattern: ${x.topPattern}` : ""}`).join("\n")
    : "No listed small-cap peers matched in the tracked universe.";
}

export async function runAnalysis(input: {
  query: string;
  capital: number;
  profile: RiskProfile;
  horizon: string;
}): Promise<Analysis> {
  const local = findInUniverse(input.query);
  const hit = local
    ? { symbol: local.symbol, name: local.name, exchange: "NSE", sector: local.sector, industry: local.industry }
    : await resolveSymbol(input.query);
  if (!hit) throw new Error(`Could not find an NSE-listed equity for "${input.query}".`);

  const chart = await fetchChart(hit.symbol, "2y", "1d");
  const snapshot = analyseCandles(chart.candles);

  const known = UNIVERSE_BY_SYMBOL.get(hit.symbol);
  const sector = known?.sector ?? hit.sector ?? "Other";
  const industry = known?.industry ?? hit.industry ?? sector;
  const drivers = SECTOR_DRIVERS[sector] ?? SECTOR_DRIVERS.Other;

  const peerEntries = competitorsFor(hit.symbol, known?.industry, sector);
  const [peers, search] = await Promise.all([
    mapLimited(peerEntries, 3, async (p) => {
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
        } satisfies Peer;
      } catch {
        return null;
      }
    }),
    fetchSearch(hit.name).catch(() => ({ hits: [], news: [] as NewsItem[] })),
  ]);
  const cleanPeers = peers.filter((p): p is Peer => p !== null);

  const patternText = snapshot.patterns
    .map((p) => `- ${p.name} [${p.kind}, weight ${p.strength}]: ${p.detail}`)
    .join("\n");

  const prompt = `Analyse this Indian NSE small-cap equity for a ${input.horizon} directional view.

COMPANY: ${hit.name} (${hit.symbol}) | Sector: ${sector} | Industry: ${industry}
PRICE: ₹${snapshot.price.toFixed(2)} | 1D ${snapshot.changePct1d.toFixed(2)}% | 5D ${snapshot.changePct5d.toFixed(2)}% | 20D ${snapshot.changePct20d.toFixed(2)}% | 60D ${snapshot.changePct60d.toFixed(2)}%
52W range: ₹${snapshot.low52.toFixed(2)} – ₹${snapshot.high52.toFixed(2)}
RSI ${snapshot.rsi?.toFixed(1)} | MACD hist ${snapshot.macdHist?.toFixed(3)} | ATR ${snapshot.atrPct?.toFixed(2)}% | Vol vs 20d avg ${(snapshot.volume / (snapshot.avgVolume20 || 1)).toFixed(2)}x
SMA20 ${snapshot.sma20?.toFixed(2)} SMA50 ${snapshot.sma50?.toFixed(2)} SMA200 ${snapshot.sma200?.toFixed(2) ?? "n/a"}
Support ₹${snapshot.support.toFixed(2)} | Resistance ₹${snapshot.resistance.toFixed(2)}
Rule-based composite score: ${snapshot.score} (${snapshot.direction}, confidence ${snapshot.confidence}%)

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
 "patternRead": "2-3 sentences interpreting the detected chart patterns together, and what would invalidate them",
 "risks": ["..."],
 "catalysts": ["..."],
 "horizonView": "what you expect over ${input.horizon}, with a rough % range",
 "aiScoreAdjustment": -20
}
aiScoreAdjustment is an integer from -20 to 20 adjusting the rule-based score for fundamentals/news/ecosystem context.`;

  const ai = await askAIJson<AiVerdict>(
    "You are a disciplined Indian small-cap equity analyst. You reason from root causes: raw-material and supply-chain costs, competitor moves and market-share shifts, government policy (PLI, FAME, tariffs) and rate cycles, plus chart-pattern evidence. You never guarantee returns. Respond with strict JSON only.",
    prompt,
    {
      thesis: "AI commentary is temporarily unavailable — the rule-based pattern engine output below is still valid.",
      rootCauses: [],
      patternRead: "",
      risks: [],
      catalysts: [],
      horizonView: "",
      aiScoreAdjustment: 0,
    },
  );

  const adj = Math.max(-20, Math.min(20, Math.round(Number(ai.aiScoreAdjustment) || 0)));
  const blendedScore = Math.max(-100, Math.min(100, snapshot.score + adj));

  const sizing = computeSizing({
    capital: input.capital,
    price: snapshot.price,
    atr: snapshot.atr,
    support: snapshot.support,
    resistance: snapshot.resistance,
    score: blendedScore,
    confidence: snapshot.confidence,
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
    snapshot: { ...snapshot, score: blendedScore },
    candles: chart.candles.slice(-260),
    peers: cleanPeers,
    news: (search.news ?? []).slice(0, 8),
    drivers,
    sizing,
    ai: { ...ai, aiScoreAdjustment: adj },
    horizon: input.horizon,
    profile: input.profile,
    generatedAt: Date.now(),
  };
}

export type DashboardData = {
  movers: (QuoteLite & { sector: string })[];
  news: NewsItem[];
  sectors: { sector: string; avgChange: number; count: number }[];
  updatedAt: number;
};

export async function runDashboard(): Promise<DashboardData> {
  const picks = UNIVERSE.slice(0, 30);
  const quotes = await mapLimited(picks, 6, (u) =>
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

export async function runSearch(query: string) {
  if (!query.trim()) return [];
  const { hits } = await fetchSearch(query).catch(() => ({ hits: [] }));
  return hits.filter((h) => h.symbol.endsWith(".NS") || h.symbol.endsWith(".BO")).slice(0, 8);
}

export async function runAgentTurn(input: {
  messages: { role: "user" | "assistant"; content: string }[];
  capital: number;
  profile: RiskProfile;
  contextSymbol?: string;
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

export async function runQuotes(symbols: string[]) {
  const quotes = await mapLimited(symbols, 6, (s) =>
    fetchQuoteLite(s, UNIVERSE_BY_SYMBOL.get(s)?.name ?? s.replace(/\.(NS|BO)$/i, "")),
  );
  return quotes.filter((q): q is QuoteLite => q !== null);
}
