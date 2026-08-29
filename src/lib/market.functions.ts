import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { runAnalysis, runDashboard, runAgentTurn, runSearch, runQuotes } from "./analysis.server";

const AnalyzeInput = z.object({
  query: z.string().min(1),
  capital: z.number().positive(),
  profile: z.enum(["conservative", "balanced", "aggressive"]),
  horizon: z.enum(["2-4 weeks", "1-3 months", "3-6 months"]),
});

export const analyzeStock = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data }) => runAnalysis(data));

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => runDashboard());

export const searchStocks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string() }).parse(d))
  .handler(async ({ data }) => runSearch(data.query));

const AgentInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  capital: z.number().nonnegative(),
  profile: z.enum(["conservative", "balanced", "aggressive"]),
  contextSymbol: z.string().optional(),
});

export const askAgent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AgentInput.parse(d))
  .handler(async ({ data }) => runAgentTurn(data));

export const getQuotes = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ symbols: z.array(z.string()).max(30) }).parse(d))
  .handler(async ({ data }) => runQuotes(data.symbols));
