import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Send, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHoldings, useSettings } from "@/hooks/useLocalStore";
import { askAgent } from "@/lib/market.functions";
import { RISK_RULES, inr } from "@/lib/risk";

export const Route = createFileRoute("/coach")({
  validateSearch: (s: Record<string, unknown>) => ({
    symbol: typeof s['symbol'] === 'string' ? (s['symbol'] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Investing Coach — SmallCap Signal" },
      {
        name: "description",
        content:
          "A step-by-step AI coach for NSE small-cap investing: entries, stop-losses, staggered buying, portfolio limits and exit discipline.",
      },
      { property: "og:title", content: "Investing Coach — SmallCap Signal" },
      {
        property: "og:description",
        content: "Guided small-cap investing: position sizing, risk limits and exit rules tuned to your capital.",
      },
    ],
  }),
  component: Coach,
});

type Msg = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Walk me through my first small-cap buy step by step",
  "How do I set a stop-loss for a volatile small-cap?",
  "How many positions should I hold with my capital?",
  "When should I book profits and when should I add more?",
];

function Coach() {
  const { symbol } = Route.useSearch();
  const [settings] = useSettings();
  const [holdings] = useHoldings();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "I'm your small-cap investing coach. Tell me what you're considering — a stock, an amount, or a doubt about risk — and I'll take you through it step by step, with position sizing and stop-loss discipline.",
    },
  ]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const ask = useServerFn(askAgent);
  const mutation = useMutation({
    mutationFn: (next: Msg[]) =>
      ask({
        data: {
          messages: next,
          capital: settings.capital || 0,
          profile: settings.profile,
          contextSymbol: symbol,
        },
      }),
    onSuccess: (r) => setMessages((m) => [...m, { role: "assistant", content: r.reply }]),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, mutation.isPending]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || mutation.isPending) return;
    const next: Msg[] = [...messages, { role: "user", content: t }];
    setMessages(next);
    setInput("");
    mutation.mutate(next);
  };

  const rule = RISK_RULES[settings.profile];
  const deployed = holdings.reduce((a, h) => a + h.qty * h.buyPrice, 0);

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1fr_320px]">
      <section className="panel flex h-[70vh] flex-col p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-primary/15 text-primary">
            <Bot className="size-4" />
          </span>
          <div>
            <h1 className="text-sm font-semibold">Investing Coach</h1>
            <p className="text-xs text-muted-foreground">
              Guidance on entries, sizing and risk{symbol ? ` · context: ${symbol}` : ""}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && (
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  <Bot className="size-3.5" />
                </span>
              )}
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-surface-2/70"
                }`}
              >
                {m.content}
              </div>
              {m.role === "user" && (
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-secondary">
                  <User className="size-3.5" />
                </span>
              )}
            </div>
          ))}
          {mutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" /> Coach is thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>

        {messages.length <= 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about an entry, a stop-loss, or how much to deploy…"
          />
          <Button type="submit" disabled={mutation.isPending}>
            <Send className="size-4" />
          </Button>
        </form>
      </section>

      <aside className="space-y-4">
        <div className="panel p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Your risk frame
          </h2>
          <dl className="space-y-2 text-sm">
            <Row label="Capital" value={inr(settings.capital, 0)} />
            <Row label="Profile" value={settings.profile} />
            <Row label="Risk / trade" value={`${(rule.riskPerTrade * 100).toFixed(0)}% (${inr(settings.capital * rule.riskPerTrade, 0)})`} />
            <Row label="Max single position" value={`${(rule.maxExposure * 100).toFixed(0)}%`} />
            <Row label="Target reward:risk" value={`${rule.rr}:1`} />
            <Row label="Deployed" value={inr(deployed, 0)} />
          </dl>
        </div>

        <div className="panel p-5">
          <h2 className="mb-3 text-sm font-semibold">Discipline checklist</h2>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {[
              "Never enter without a written stop-loss.",
              "One position ≤ the exposure cap, even on high conviction.",
              "Stagger entries — starter, breakout confirmation, pullback.",
              "Book half at Target 1, trail the stop to breakeven.",
              "Cut the position if the pattern that justified it is invalidated.",
              "Small caps gap — size for the gap, not the average day.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-5">
          <h2 className="mb-2 text-sm font-semibold">Scope</h2>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">NSE equity only</Badge>
            <Badge variant="outline">No index</Badge>
            <Badge variant="outline">No F&O</Badge>
            <Badge variant="outline">No forex</Badge>
          </div>
        </div>
      </aside>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num text-sm capitalize">{value}</dd>
    </div>
  );
}
