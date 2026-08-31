import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";
const URLC = "https://query1.finance.yahoo.com/v8/finance/chart/SUZLON.NS?range=1mo&interval=1d";

export const Route = createFileRoute("/api/public/yfdebug")({
  server: {
    handlers: {
      GET: async () => {
        const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
        const ck = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
        const tries: Record<string, number> = {};
        const variants: Record<string, Record<string, string>> = {
          plain: {},
          ua: { "User-Agent": UA },
          uaCookie: { "User-Agent": UA, Cookie: ck },
          full: {
            "User-Agent": UA,
            Cookie: ck,
            Accept: "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://finance.yahoo.com/",
            Origin: "https://finance.yahoo.com",
          },
        };
        for (const [k, h] of Object.entries(variants)) {
          const res = await fetch(URLC, { headers: h });
          tries[k] = res.status;
        }
        const st = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(URLC));
        tries["proxy"] = st.status;
        return Response.json(tries);
      },
    },
  },
});
