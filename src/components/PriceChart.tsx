import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Candle } from "@/lib/indicators";
import { sma } from "@/lib/indicators";

type Props = {
  candles: Candle[];
  support?: number;
  resistance?: number;
  stop?: number;
  target?: number;
};

export function PriceChart({ candles, support, resistance, stop, target }: Props) {
  const closes = candles.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const data = candles.map((c, i) => ({
    date: new Date(c.t * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    close: c.c,
    sma20: s20[i],
    sma50: s50[i],
    volume: c.v,
  }));

  return (
    <div className="space-y-1">
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-bull)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-bull)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" minTickGap={48} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
            <YAxis
              domain={["auto", "auto"]}
              width={58}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-muted-foreground)" }}
              formatter={(v: number | string, name: string) => [
                typeof v === "number" ? `₹${v.toFixed(2)}` : v,
                name,
              ]}
            />
            <Area type="monotone" dataKey="close" name="Close" stroke="var(--color-bull)" strokeWidth={2} fill="url(#px)" />
            <Line type="monotone" dataKey="sma20" name="SMA 20" stroke="var(--color-accent)" dot={false} strokeWidth={1.2} />
            <Line type="monotone" dataKey="sma50" name="SMA 50" stroke="var(--color-chart-3)" dot={false} strokeWidth={1.2} />
            {support ? <ReferenceLine y={support} stroke="var(--color-chart-3)" strokeDasharray="4 4" label={{ value: "Support", fill: "var(--color-muted-foreground)", fontSize: 10, position: "insideBottomLeft" }} /> : null}
            {resistance ? <ReferenceLine y={resistance} stroke="var(--color-warn)" strokeDasharray="4 4" label={{ value: "Resistance", fill: "var(--color-muted-foreground)", fontSize: 10, position: "insideTopLeft" }} /> : null}
            {stop ? <ReferenceLine y={stop} stroke="var(--color-bear)" strokeDasharray="6 3" label={{ value: "Stop", fill: "var(--color-bear)", fontSize: 10, position: "insideBottomRight" }} /> : null}
            {target ? <ReferenceLine y={target} stroke="var(--color-bull)" strokeDasharray="6 3" label={{ value: "Target", fill: "var(--color-bull)", fontSize: 10, position: "insideTopRight" }} /> : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="h-[70px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                fontSize: 12,
              }}
              formatter={(v: number) => [v.toLocaleString("en-IN"), "Volume"]}
            />
            <Bar dataKey="volume" fill="var(--color-grid)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const data = points.map((p, i) => ({ i, p }));
  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area
            type="monotone"
            dataKey="p"
            stroke={up ? "var(--color-bull)" : "var(--color-bear)"}
            fill="transparent"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
