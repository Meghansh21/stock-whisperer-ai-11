import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Factory,
  Landmark,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PriceChart } from "@/components/PriceChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useHoldings, useSettings } from "@/hooks/useLocalStore";
import { analyzeStock } from "@/lib/market.functions";
import { RISK_RULES, inr } from "@/lib/risk";

export const Route = createFileRoute("/analyze")({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s['q'] === 'string' ? (s['q'] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Stock Analyzer — SmallCap Signal" },
      {
        name: "description",
        content:
          "Enter an NSE company and capital: get chart-pattern detection, competitor and supply-chain root causes, and a risk-managed position size.",
      },
      { property: "og:title", content: "Stock Analyzer — SmallCap Signal" },
      {
        property: "og:description",
        content: "Pattern recognition, competitor scan and position sizing for Indian small-cap equities.",
      },
    ],
  }),
  component: Analyze,
});

const VERDICT_TONE: Record<string, string> = {
  Buy: "bg-bull/15 text-bull border-bull/40",
  Accumulate: "bg-primary/10 text-primary border-primary/30",
  Watchlist: "bg-warn/15 text-warn border-warn/40",
  Avoid: "bg-bear/15 text-bear border-bear/40",
};

function Analyze() {
  const { q } = Route.useSearch();
  const [settings, setSettings] = useSettings();
  const [holdings, setHoldings] = useHoldings();
  const [query, setQuery] = useState(q ?? "");

  const run = useServerFn(analyzeStock);
  const mutation = useMutation({
    mutationFn: (vars: { query: string }) =>
      run({
        data: {
          query: vars.query,
          capital: settings.capital || 100000,
          profile: settings.profile,
          horizon: settings.horizon,
        },
      }),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (q) {
      setQuery(q);
      mutation.mutate({ query: q });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const a = mutation.data;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock Analyzer</h1>
        <p className="text-sm text-muted-foreground">
          Give a company name and your capital — the engine pulls the tape, detects chart patterns, scans
          competitors and supply-chain drivers, then sizes the position for you.
        </p>
      </div>

      <form
        className="panel grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) mutation.mutate({ query: query.trim() });
        }}
      >
        <div>
          <p className="label-xs mb-1">Company or NSE symbol</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Suzlon Energy or SYRMA.NS"
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <p className="label-xs mb-1">Capital (₹)</p>
          <Input
            type="number"
            className="num"
            value={settings.capital}
            onChange={(e) => setSettings({ ...settings, capital: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <p className="label-xs mb-1">Risk profile</p>
          <Select
            value={settings.profile}
            onValueChange={(v) => setSettings({ ...settings, profile: v as typeof settings.profile })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RISK_RULES) as (keyof typeof RISK_RULES)[]).map((k) => (
                <SelectItem key={k} value={k} className="capitalize">
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="label-xs mb-1">Horizon</p>
          <Select
            value={settings.horizon}
            onValueChange={(v) => setSettings({ ...settings, horizon: v as typeof settings.horizon })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2-4 weeks">2-4 weeks</SelectItem>
              <SelectItem value="1-3 months">1-3 months</SelectItem>
              <SelectItem value="3-6 months">3-6 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={mutation.isPending} className="w-full">
            <Sparkles className="size-4" />
            {mutation.isPending ? "Analysing…" : "Analyse"}
          </Button>
        </div>
      </form>

      {mutation.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      )}

      {a && (
        <div className="space-y-6">
          {/* Header + verdict */}
          <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">{a.name}</h2>
                <Badge variant="outline" className="num">{a.symbol}</Badge>
                <Badge variant="secondary">{a.sector}</Badge>
              </div>
              <p className="num mt-1 text-3xl font-semibold">
                {inr(a.price)}{" "}
                <span className={a.snapshot.changePct1d >= 0 ? "text-bull text-base" : "text-bear text-base"}>
                  {a.snapshot.changePct1d >= 0 ? "+" : ""}
                  {a.snapshot.changePct1d.toFixed(2)}%
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.exchange} · {a.industry} · 52W ₹{a.snapshot.low52.toFixed(2)}–₹{a.snapshot.high52.toFixed(2)}
              </p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="label-xs">Signal</p>
                <p
                  className={`num text-2xl font-semibold ${
                    a.snapshot.score > 12 ? "text-bull" : a.snapshot.score < -12 ? "text-bear" : "text-warn"
                  }`}
                >
                  {a.snapshot.score > 0 ? "+" : ""}
                  {a.snapshot.score}
                </p>
                <p className="text-xs text-muted-foreground">{a.snapshot.direction}</p>
              </div>
              <div className="text-center">
                <p className="label-xs">Confidence</p>
                <p className="num text-2xl font-semibold">{a.snapshot.confidence}%</p>
                <p className="text-xs text-muted-foreground">{a.horizon}</p>
              </div>
              <div
                className={`rounded-xl border px-5 py-3 text-center ${VERDICT_TONE[a.sizing.verdict]}`}
              >
                <p className="label-xs">Verdict</p>
                <p className="text-lg font-semibold">{a.sizing.verdict}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="panel p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Price action, moving averages & levels</h3>
                <span className="label-xs">daily · 1y</span>
              </div>
              <PriceChart
                candles={a.candles}
                support={a.snapshot.support}
                resistance={a.snapshot.resistance}
                stop={a.sizing.stopLoss}
                target={a.sizing.target1}
              />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="RSI (14)" value={a.snapshot.rsi?.toFixed(1) ?? "—"} />
                <Metric label="ATR %" value={`${a.snapshot.atrPct?.toFixed(2) ?? "—"}%`} />
                <Metric label="Vol vs 20d" value={`${(a.snapshot.volume / (a.snapshot.avgVolume20 || 1)).toFixed(2)}x`} />
                <Metric label="60D return" value={`${a.snapshot.changePct60d.toFixed(1)}%`} />
              </div>
            </section>

            {/* Position sizing */}
            <section className="panel space-y-4 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Target className="size-4 text-primary" /> Position & risk plan
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Invest" value={inr(a.sizing.investAmount, 0)} tone="bull" />
                <Metric label="Quantity" value={`${a.sizing.shares} sh`} />
                <Metric label="Entry" value={inr(a.sizing.entry)} />
                <Metric label="Stop loss" value={inr(a.sizing.stopLoss)} tone="bear" />
                <Metric label="Target 1" value={inr(a.sizing.target1)} tone="bull" />
                <Metric label="Target 2" value={inr(a.sizing.target2)} tone="bull" />
                <Metric label="Max loss" value={inr(a.sizing.maxLossAmount, 0)} tone="bear" />
                <Metric label="Reward:Risk" value={`${a.sizing.rewardRisk.toFixed(2)}:1`} />
              </div>
              <div>
                <p className="label-xs mb-1">Allocation of capital</p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, a.sizing.allocationPct)}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.sizing.allocationPct.toFixed(1)}% of {inr(settings.capital, 0)}
                </p>
              </div>
              {a.sizing.tranches.length > 0 && (
                <div className="space-y-2">
                  <p className="label-xs">Staggered entry</p>
                  {a.sizing.tranches.map((t) => (
                    <div key={t.label} className="rounded-lg bg-surface-2/60 p-2 text-xs">
                      <span className="num font-semibold text-primary">{inr(t.amount, 0)}</span> — {t.trigger}
                    </div>
                  ))}
                </div>
              )}
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {a.sizing.notes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {n}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={a.sizing.shares === 0}
                  onClick={() => {
                    setHoldings([
                      ...holdings,
                      {
                        symbol: a.symbol,
                        name: a.name,
                        qty: a.sizing.shares,
                        buyPrice: a.sizing.entry,
                        stopLoss: a.sizing.stopLoss,
                        target: a.sizing.target1,
                        addedAt: Date.now(),
                      },
                    ]);
                    toast.success(`${a.name} added to your portfolio`);
                  }}
                >
                  Add to portfolio
                </Button>
                <Button variant="secondary" asChild>
                  <Link to="/coach" search={{ symbol: a.symbol }}>
                    Ask coach
                  </Link>
                </Button>
              </div>
            </section>
          </div>

          {/* Patterns */}
          <section className="panel p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="size-4 text-primary" /> Detected chart patterns ({a.snapshot.patterns.length})
            </h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {a.snapshot.patterns.map((p) => (
                <div
                  key={p.name}
                  className={`rounded-lg border p-3 ${
                    p.kind === "bullish"
                      ? "border-bull/35 bg-bull/5"
                      : p.kind === "bearish"
                        ? "border-bear/35 bg-bear/5"
                        : "border-warn/35 bg-warn/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{p.name}</p>
                    <span className="num text-[10px] uppercase tracking-widest text-muted-foreground">
                      {p.kind} · {(p.strength * 100).toFixed(0)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
                </div>
              ))}
              {a.snapshot.patterns.length === 0 && (
                <p className="text-sm text-muted-foreground">No significant patterns on the daily chart.</p>
              )}
            </div>
            {a.ai.patternRead && (
              <p className="mt-4 rounded-lg bg-surface-2/60 p-3 text-sm leading-relaxed">{a.ai.patternRead}</p>
            )}
          </section>

          {/* Root cause */}
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="panel p-5 lg:col-span-2">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-primary" /> Root-cause thesis
              </h3>
              <p className="text-sm leading-relaxed">{a.ai.thesis}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {a.ai.rootCauses?.map((r) => (
                  <div key={r.driver} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{r.driver}</p>
                      <Badge
                        variant="outline"
                        className={
                          r.direction === "positive"
                            ? "border-bull/40 text-bull"
                            : r.direction === "negative"
                              ? "border-bear/40 text-bear"
                              : "border-warn/40 text-warn"
                        }
                      >
                        {r.type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.impact}</p>
                  </div>
                ))}
              </div>
              {a.ai.horizonView && (
                <p className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
                  <span className="label-xs mr-2">{a.horizon} view</span>
                  {a.ai.horizonView}
                </p>
              )}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="label-xs mb-2 flex items-center gap-1">
                    <AlertTriangle className="size-3.5" /> Key risks
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {a.ai.risks?.map((r) => <li key={r}>• {r}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="label-xs mb-2 flex items-center gap-1">
                    <Sparkles className="size-3.5" /> Catalysts
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {a.ai.catalysts?.map((r) => <li key={r}>• {r}</li>)}
                  </ul>
                </div>
              </div>
            </section>

            <div className="space-y-6">
              <section className="panel p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-primary" /> Competitor tape
                </h3>
                <div className="space-y-2">
                  {a.peers.map((p) => (
                    <Link
                      key={p.symbol}
                      to="/analyze"
                      search={{ q: p.symbol }}
                      className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2 hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.topPattern ?? p.direction}</p>
                      </div>
                      <div className="text-right">
                        <p className="num text-sm">{inr(p.price)}</p>
                        <p className={`num text-xs ${p.changePct >= 0 ? "text-bull" : "text-bear"}`}>
                          {p.changePct >= 0 ? "+" : ""}
                          {p.changePct.toFixed(2)}% · score {p.score}
                        </p>
                      </div>
                    </Link>
                  ))}
                  {a.peers.length === 0 && (
                    <p className="text-sm text-muted-foreground">No tracked listed peers for this industry.</p>
                  )}
                </div>
              </section>

              <section className="panel p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Factory className="size-4 text-primary" /> Ecosystem drivers
                </h3>
                <p className="label-xs mb-1">Upstream cost inputs</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {a.drivers.upstream.map((u) => (
                    <Badge key={u} variant="secondary" className="text-[11px]">
                      {u}
                    </Badge>
                  ))}
                </div>
                <p className="label-xs mb-1 flex items-center gap-1">
                  <Landmark className="size-3.5" /> Policy & macro triggers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {a.drivers.policy.map((u) => (
                    <Badge key={u} variant="outline" className="text-[11px]">
                      {u}
                    </Badge>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {a.news.length > 0 && (
            <section className="panel p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Building2 className="size-4 text-primary" /> Company headlines
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {a.news.map((n) => (
                  <a
                    key={n.link}
                    href={n.link}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-border/60 p-3 text-sm hover:border-primary/60"
                  >
                    {n.title}
                    <p className="label-xs mt-2">{n.publisher}</p>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-lg bg-surface-2/60 p-3">
      <p className="label-xs">{label}</p>
      <p className={`num mt-0.5 text-sm font-semibold ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""}`}>
        {value}
      </p>
    </div>
  );
}
