import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownRight, ArrowUpRight, Newspaper, Pin, RefreshCw, Trash2, Wallet } from "lucide-react";

import { Sparkline } from "@/components/PriceChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useHoldings, usePinned, useSettings } from "@/hooks/useLocalStore";
import { getDashboard, getQuotes } from "@/lib/market.functions";
import { inr } from "@/lib/risk";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — SmallCap Signal" },
      {
        name: "description",
        content:
          "Live NSE small-cap dashboard: portfolio P&L, top gainers and losers, pinned stocks, sector strength and market news.",
      },
      { property: "og:title", content: "Dashboard — SmallCap Signal" },
      {
        property: "og:description",
        content: "Track NSE small-cap movers, sector strength and your position-level P&L in one terminal.",
      },
    ],
  }),
  component: Dashboard,
});

function Pct({ v, className = "" }: { v: number; className?: string }) {
  const up = v >= 0;
  return (
    <span className={`num inline-flex items-center gap-0.5 ${up ? "text-bull" : "text-bear"} ${className}`}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {up ? "+" : ""}
      {v.toFixed(2)}%
    </span>
  );
}

function Dashboard() {
  const [settings, setSettings] = useSettings();
  const [pinned, setPinned] = usePinned();
  const [holdings, setHoldings] = useHoldings();

  const dash = useServerFn(getDashboard);
  const quotes = useServerFn(getQuotes);

  const board = useQuery({ queryKey: ["dashboard"], queryFn: () => dash({}), staleTime: 60_000 });

  const watchSymbols = [...new Set([...pinned, ...holdings.map((h) => h.symbol)])];
  const watch = useQuery({
    queryKey: ["quotes", watchSymbols.join(",")],
    queryFn: () => quotes({ data: { symbols: watchSymbols } }),
    enabled: watchSymbols.length > 0,
    staleTime: 60_000,
  });

  const priceOf = (s: string) => watch.data?.find((q) => q.symbol === s)?.price ?? null;
  const invested = holdings.reduce((a, h) => a + h.qty * h.buyPrice, 0);
  const current = holdings.reduce((a, h) => a + h.qty * (priceOf(h.symbol) ?? h.buyPrice), 0);
  const pnl = current - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  const movers = board.data?.movers ?? [];
  const gainers = [...movers].sort((a, b) => b.changePct - a.changePct).slice(0, 6);
  const losers = [...movers].sort((a, b) => a.changePct - b.changePct).slice(0, 6);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Market Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            NSE equity only — small-cap growth universe (renewables, EMS, EV ancillaries, infra).
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <p className="label-xs mb-1">Capital</p>
            <Input
              type="number"
              value={settings.capital}
              onChange={(e) => setSettings({ ...settings, capital: Number(e.target.value) || 0 })}
              className="num h-9 w-36"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => board.refetch()} disabled={board.isFetching}>
            <RefreshCw className={`size-4 ${board.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Capital" value={inr(settings.capital, 0)} sub={`${settings.profile} risk profile`} />
        <Stat label="Deployed" value={inr(current, 0)} sub={`${holdings.length} open position(s)`} />
        <Stat
          label="Unrealised P&L"
          value={`${pnl >= 0 ? "+" : "-"}${inr(Math.abs(pnl), 0)}`}
          sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% on invested`}
          tone={pnl >= 0 ? "bull" : "bear"}
        />
        <Stat
          label="Free cash"
          value={inr(Math.max(0, settings.capital - current), 0)}
          sub={`${(100 - (settings.capital ? (current / settings.capital) * 100 : 0)).toFixed(0)}% uninvested`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Top gainers</h2>
            <span className="label-xs">today</span>
          </div>
          <MoverList list={gainers} loading={board.isLoading} pinned={pinned} setPinned={setPinned} />
          <div className="mb-4 mt-8 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Top losers</h2>
            <span className="label-xs">today</span>
          </div>
          <MoverList list={losers} loading={board.isLoading} pinned={pinned} setPinned={setPinned} />
        </section>

        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Pin className="size-4 text-primary" /> Pinned stocks
            </h2>
            <div className="space-y-2">
              {watchSymbols.length === 0 && <p className="text-sm text-muted-foreground">Pin stocks to track them here.</p>}
              {pinned.map((s) => {
                const q = watch.data?.find((x) => x.symbol === s);
                return (
                  <div key={s} className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{q?.name ?? s.replace(".NS", "")}</p>
                      <p className="num text-xs text-muted-foreground">{s}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {q ? <Sparkline points={q.spark} up={q.changePct >= 0} /> : <Skeleton className="h-8 w-20" />}
                      <div className="text-right">
                        <p className="num text-sm">{q ? inr(q.price) : "—"}</p>
                        {q && <Pct v={q.changePct} className="text-xs" />}
                      </div>
                      <button
                        className="text-muted-foreground hover:text-bear"
                        onClick={() => setPinned(pinned.filter((p) => p !== s))}
                        aria-label={`Unpin ${s}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="mb-3 text-sm font-semibold">Sector strength</h2>
            <div className="space-y-2">
              {(board.data?.sectors ?? []).map((s) => (
                <div key={s.sector} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs">{s.sector}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${s.avgChange >= 0 ? "bg-bull" : "bg-bear"}`}
                      style={{ width: `${Math.min(100, Math.abs(s.avgChange) * 20 + 6)}%` }}
                    />
                  </div>
                  <Pct v={s.avgChange} className="w-20 justify-end text-xs" />
                </div>
              ))}
              {board.isLoading && <Skeleton className="h-24 w-full" />}
            </div>
          </section>
        </div>
      </div>

      <section className="panel p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4 text-primary" /> Portfolio
        </h2>
        {holdings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No positions yet.{" "}
            <Link to="/analyze" className="text-primary underline underline-offset-4">
              Analyse a stock
            </Link>{" "}
            and add the suggested position.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label-xs text-left">
                  <th className="pb-2">Stock</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Buy</th>
                  <th className="pb-2">LTP</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2 text-right">P&L</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const ltp = priceOf(h.symbol) ?? h.buyPrice;
                  const p = (ltp - h.buyPrice) * h.qty;
                  return (
                    <tr key={h.symbol + h.addedAt} className="border-t border-border/60">
                      <td className="py-2">
                        <p className="font-medium">{h.name}</p>
                        <p className="num text-xs text-muted-foreground">{h.symbol}</p>
                      </td>
                      <td className="num">{h.qty}</td>
                      <td className="num">{inr(h.buyPrice)}</td>
                      <td className="num">{inr(ltp)}</td>
                      <td className="num text-bear">{inr(h.stopLoss)}</td>
                      <td className="num text-bull">{inr(h.target)}</td>
                      <td className={`num text-right ${p >= 0 ? "text-bull" : "text-bear"}`}>
                        {p >= 0 ? "+" : "-"}
                        {inr(Math.abs(p), 0)}
                      </td>
                      <td className="text-right">
                        <button
                          className="text-muted-foreground hover:text-bear"
                          onClick={() => setHoldings(holdings.filter((x) => x.addedAt !== h.addedAt))}
                          aria-label="Remove position"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Newspaper className="size-4 text-primary" /> Market news
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(board.data?.news ?? []).map((n) => (
            <a
              key={n.link}
              href={n.link}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border/60 p-3 transition-colors hover:border-primary/60"
            >
              <p className="text-sm font-medium leading-snug">{n.title}</p>
              <p className="label-xs mt-2">{n.publisher}</p>
            </a>
          ))}
          {board.isLoading && <Skeleton className="h-20 w-full" />}
          {!board.isLoading && (board.data?.news?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No headlines available right now.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "bull" | "bear";
}) {
  return (
    <div className="panel p-4">
      <p className="label-xs">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function MoverList({
  list,
  loading,
  pinned,
  setPinned,
}: {
  list: { symbol: string; name: string; price: number; changePct: number; spark: number[]; sector: string }[];
  loading: boolean;
  pinned: string[];
  setPinned: (v: string[]) => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {list.map((m) => (
        <div key={m.symbol} className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2">
          <div className="min-w-0">
            <Link
              to="/analyze"
              search={{ q: m.symbol }}
              className="truncate text-sm font-medium hover:text-primary"
            >
              {m.name}
            </Link>
            <Badge variant="outline" className="ml-1 text-[10px]">
              {m.sector}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Sparkline points={m.spark} up={m.changePct >= 0} />
            <div className="text-right">
              <p className="num text-sm">{inr(m.price)}</p>
              <Pct v={m.changePct} className="text-xs" />
            </div>
            <button
              className={pinned.includes(m.symbol) ? "text-primary" : "text-muted-foreground hover:text-primary"}
              onClick={() =>
                setPinned(pinned.includes(m.symbol) ? pinned.filter((p) => p !== m.symbol) : [...pinned, m.symbol])
              }
              aria-label="Pin stock"
            >
              <Pin className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
