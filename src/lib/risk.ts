// Position sizing & risk management (pure — shared by server and UI).

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export const RISK_RULES: Record<RiskProfile, { riskPerTrade: number; maxExposure: number; rr: number; label: string }> = {
  conservative: { riskPerTrade: 0.01, maxExposure: 0.12, rr: 2.5, label: "Capital preservation first" },
  balanced: { riskPerTrade: 0.02, maxExposure: 0.2, rr: 2, label: "Standard swing-trading risk" },
  aggressive: { riskPerTrade: 0.03, maxExposure: 0.3, rr: 1.8, label: "High conviction, higher drawdown" },
};

export type SizingInput = {
  capital: number;
  price: number;
  atr: number | null;
  support: number;
  resistance: number;
  score: number;
  confidence: number;
  profile: RiskProfile;
  avgVolume20: number;
};

export type Sizing = {
  verdict: "Buy" | "Accumulate" | "Watchlist" | "Avoid";
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskPerShare: number;
  shares: number;
  investAmount: number;
  allocationPct: number;
  maxLossAmount: number;
  potentialGain: number;
  rewardRisk: number;
  tranches: { label: string; amount: number; trigger: string }[];
  notes: string[];
};

export function computeSizing(i: SizingInput): Sizing {
  const rule = RISK_RULES[i.profile];
  const atr = i.atr && i.atr > 0 ? i.atr : i.price * 0.03;
  const notes: string[] = [];

  const entry = i.price;
  const atrStop = entry - 1.8 * atr;
  const structureStop = i.support * 0.985;
  const stopLoss = Math.max(Math.min(atrStop, structureStop), entry * 0.85);
  const riskPerShare = Math.max(entry - stopLoss, entry * 0.01);

  const target1 = entry + riskPerShare * rule.rr;
  const target2 = Math.max(i.resistance * 1.02, entry + riskPerShare * rule.rr * 1.8);

  // Confidence & score scale the capital at risk.
  const convictionFactor = Math.max(0, Math.min(1, (i.score / 60) * (i.confidence / 80)));
  const riskBudget = i.capital * rule.riskPerTrade * (0.4 + 0.6 * convictionFactor);
  let shares = Math.floor(riskBudget / riskPerShare);

  // Cap 1: single-position exposure ceiling.
  const exposureCap = Math.floor((i.capital * rule.maxExposure) / entry);
  if (shares > exposureCap) {
    shares = exposureCap;
    notes.push(`Capped at ${(rule.maxExposure * 100).toFixed(0)}% of capital — single small-cap position limit.`);
  }
  // Cap 2: liquidity — never take more than 1% of 20-day average traded volume.
  if (i.avgVolume20 > 0) {
    const liqCap = Math.floor(i.avgVolume20 * 0.01);
    if (shares > liqCap) {
      shares = liqCap;
      notes.push("Trimmed for liquidity — position kept under 1% of average daily volume so you can exit.");
    }
  }
  if (shares < 0) shares = 0;

  const investAmount = shares * entry;
  const maxLossAmount = shares * riskPerShare;
  const allocationPct = i.capital > 0 ? (investAmount / i.capital) * 100 : 0;

  let verdict: Sizing["verdict"];
  if (i.score >= 35 && i.confidence >= 60) verdict = "Buy";
  else if (i.score >= 12) verdict = "Accumulate";
  else if (i.score > -15) verdict = "Watchlist";
  else verdict = "Avoid";

  if (verdict === "Avoid" || verdict === "Watchlist") {
    notes.push(
      verdict === "Avoid"
        ? "Signals are net negative — no fresh capital until the trend structure repairs."
        : "Mixed signals — wait for a breakout close or a higher low before committing.",
    );
  }
  const finalShares = verdict === "Avoid" ? 0 : verdict === "Watchlist" ? Math.floor(shares * 0.3) : shares;
  const finalInvest = finalShares * entry;

  const tranches =
    finalShares > 0
      ? [
          { label: "Tranche 1", amount: Math.round(finalInvest * 0.5), trigger: "Now, at market — starter position" },
          {
            label: "Tranche 2",
            amount: Math.round(finalInvest * 0.3),
            trigger: `On a close above ₹${(i.resistance).toFixed(2)} (breakout confirmation)`,
          },
          {
            label: "Tranche 3",
            amount: Math.round(finalInvest * 0.2),
            trigger: `On a pullback to ₹${(entry - atr).toFixed(2)} that holds the stop`,
          },
        ]
      : [];

  notes.push(`Risk per trade fixed at ${(rule.riskPerTrade * 100).toFixed(0)}% of capital (${rule.label}).`);
  notes.push("Trail the stop to breakeven once Target 1 is hit; book 50% there.");

  return {
    verdict,
    entry,
    stopLoss,
    target1,
    target2,
    riskPerShare,
    shares: finalShares,
    investAmount: finalInvest,
    allocationPct: i.capital > 0 ? (finalInvest / i.capital) * 100 : 0,
    maxLossAmount: finalShares * riskPerShare,
    potentialGain: finalShares * (target1 - entry),
    rewardRisk: (target1 - entry) / riskPerShare,
    tranches,
    notes,
  };
}

export const inr = (n: number, d = 2) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
