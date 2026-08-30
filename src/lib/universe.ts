// Curated NSE small-cap universe (focus: sub-₹300 growth names in progressive sectors).
// Used for competitor discovery, sector context and the dashboard scan.

export type UniverseEntry = {
  symbol: string; // Yahoo symbol (NSE)
  name: string;
  sector: string;
  industry: string;
  upstream: string[]; // raw material / cost drivers
  policy: string[]; // macro & policy triggers
};

export const SECTOR_DRIVERS: Record<string, { upstream: string[]; policy: string[] }> = {
  "Renewable Energy": {
    upstream: ["Polysilicon", "Solar cells & wafers", "Steel", "Copper", "Rare-earth magnets"],
    policy: ["ALMM / PLI for solar modules", "SECI & state auctions", "Basic customs duty on cells", "RBI rate cycle (project financing)"],
  },
  "Electronics Manufacturing": {
    upstream: ["Semiconductor chips", "PCB laminates", "Copper", "Gold bonding wire", "Plastic resins"],
    policy: ["PLI for white goods & IT hardware", "SPECS scheme", "Import duty on components", "USD/INR pass-through on BOM"],
  },
  "EV & Auto Ancillary": {
    upstream: ["Lithium & cells", "Steel", "Aluminium", "Rare-earth magnets", "Rubber"],
    policy: ["FAME / EMPS subsidies", "PLI-Auto", "State EV policies", "Crude oil price (substitution effect)"],
  },
  "Power & Transmission": {
    upstream: ["Copper", "Aluminium", "Transformer steel (CRGO)", "Crude derivatives"],
    policy: ["RDSS distribution reform", "Green energy corridor tenders", "Interest rate cycle"],
  },
  Infrastructure: {
    upstream: ["Cement", "Steel", "Bitumen / crude", "Diesel"],
    policy: ["Union budget capex", "NHAI & railway ordering", "State election spending"],
  },
  "Textiles & Chemicals": {
    upstream: ["Cotton", "Crude derivatives", "Caustic soda", "Coal"],
    policy: ["PLI-Textiles", "China+1 export demand", "Anti-dumping duty"],
  },
  Financials: {
    upstream: ["Cost of funds", "Bond yields"],
    policy: ["RBI repo rate", "Provisioning norms", "Credit growth cycle"],
  },
  Other: { upstream: ["Input costs", "Energy"], policy: ["Union budget", "Interest rates"] },
};

const U = (
  symbol: string,
  name: string,
  sector: string,
  industry: string,
): UniverseEntry => ({
  symbol,
  name,
  sector,
  industry,
  upstream: SECTOR_DRIVERS[sector]?.upstream ?? SECTOR_DRIVERS["Other"]!.upstream,
  policy: SECTOR_DRIVERS[sector]?.policy ?? SECTOR_DRIVERS["Other"]!.policy,
});

export const UNIVERSE: UniverseEntry[] = [
  // Renewable energy
  U("SUZLON.NS", "Suzlon Energy", "Renewable Energy", "Wind turbines"),
  U("INOXWIND.NS", "Inox Wind", "Renewable Energy", "Wind turbines"),
  U("WEBELSOLAR.NS", "Websol Energy System", "Renewable Energy", "Solar cells"),
  U("URJA.NS", "Urja Global", "Renewable Energy", "Solar EPC"),
  U("ORIENTGREEN.NS", "Orient Green Power", "Renewable Energy", "Wind IPP"),
  U("KPIGREEN.NS", "KPI Green Energy", "Renewable Energy", "Solar IPP"),
  U("SWSOLAR.NS", "Sterling & Wilson Solar", "Renewable Energy", "Solar EPC"),
  U("GENSOL.NS", "Gensol Engineering", "Renewable Energy", "Solar EPC"),
  // EMS / electronics
  U("SYRMA.NS", "Syrma SGS Technology", "Electronics Manufacturing", "EMS"),
  U("AVALON.NS", "Avalon Technologies", "Electronics Manufacturing", "EMS"),
  U("ELIN.NS", "Elin Electronics", "Electronics Manufacturing", "EMS"),
  U("VISHNU.NS", "Vishnu Chemicals", "Textiles & Chemicals", "Specialty chemicals"),
  U("MIRCELECTR.NS", "MIRC Electronics", "Electronics Manufacturing", "Consumer electronics"),
  U("PGEL.NS", "PG Electroplast", "Electronics Manufacturing", "EMS"),
  U("DIXON.NS", "Dixon Technologies", "Electronics Manufacturing", "EMS"),
  U("AMBER.NS", "Amber Enterprises", "Electronics Manufacturing", "EMS"),
  // EV & auto ancillary
  U("OLECTRA.NS", "Olectra Greentech", "EV & Auto Ancillary", "Electric buses"),
  U("JBMA.NS", "JBM Auto", "EV & Auto Ancillary", "Buses & components"),
  U("GREAVESCOT.NS", "Greaves Cotton", "EV & Auto Ancillary", "Powertrain"),
  U("SANDHAR.NS", "Sandhar Technologies", "EV & Auto Ancillary", "Auto components"),
  U("MUNJALSHOW.NS", "Munjal Showa", "EV & Auto Ancillary", "Auto components"),
  U("LUMAXTECH.NS", "Lumax Auto Tech", "EV & Auto Ancillary", "Auto components"),
  // Power & transmission
  U("RTNPOWER.NS", "RattanIndia Power", "Power & Transmission", "Thermal IPP"),
  U("JPPOWER.NS", "Jaiprakash Power", "Power & Transmission", "Power generation"),
  U("GVKPIL.NS", "GVK Power", "Power & Transmission", "Power & infra"),
  U("KECL.NS", "Kirloskar Electric", "Power & Transmission", "Electrical equipment"),
  U("SALASAR.NS", "Salasar Techno Engg", "Power & Transmission", "Transmission towers"),
  U("APOLLO.NS", "Apollo Micro Systems", "Electronics Manufacturing", "Defence electronics"),
  // Infra
  U("NBCC.NS", "NBCC India", "Infrastructure", "Construction"),
  U("IRCON.NS", "Ircon International", "Infrastructure", "Railway EPC"),
  U("RVNL.NS", "Rail Vikas Nigam", "Infrastructure", "Railway EPC"),
  U("HCC.NS", "Hindustan Construction", "Infrastructure", "Construction"),
  U("PATELENG.NS", "Patel Engineering", "Infrastructure", "Construction"),
  U("ITDCEM.NS", "ITD Cementation", "Infrastructure", "Construction"),
  // Textiles & chemicals
  U("TRIDENT.NS", "Trident", "Textiles & Chemicals", "Textiles"),
  U("SPAL.NS", "S P Apparels", "Textiles & Chemicals", "Apparel"),
  U("NAHARSPING.NS", "Nahar Spinning", "Textiles & Chemicals", "Spinning"),
  U("GHCL.NS", "GHCL", "Textiles & Chemicals", "Soda ash"),
  // Financials (small-cap)
  U("UJJIVANSFB.NS", "Ujjivan Small Fin Bank", "Financials", "Small finance bank"),
  U("SURYODAY.NS", "Suryoday Small Fin Bank", "Financials", "Small finance bank"),
  U("IOB.NS", "Indian Overseas Bank", "Financials", "PSU bank"),
  U("UCOBANK.NS", "UCO Bank", "Financials", "PSU bank"),
  U("SOUTHBANK.NS", "South Indian Bank", "Financials", "Private bank"),
  U("IDFCFIRSTB.NS", "IDFC First Bank", "Financials", "Private bank"),
];

export const UNIVERSE_BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u]));

export function findInUniverse(query: string): UniverseEntry | undefined {
  const q = query.trim().toLowerCase();
  return (
    UNIVERSE.find((u) => u.symbol.toLowerCase() === q || u.symbol.replace(".NS", "").toLowerCase() === q) ??
    UNIVERSE.find((u) => u.name.toLowerCase() === q) ??
    UNIVERSE.find((u) => u.name.toLowerCase().includes(q) && q.length >= 3)
  );
}

export function competitorsFor(symbol: string, industry?: string, sector?: string): UniverseEntry[] {
  const base = UNIVERSE_BY_SYMBOL.get(symbol);
  const ind = industry ?? base?.industry;
  const sec = sector ?? base?.sector;
  const sameIndustry = UNIVERSE.filter((u) => u.symbol !== symbol && ind && u.industry === ind);
  const sameSector = UNIVERSE.filter((u) => u.symbol !== symbol && sec && u.sector === sec);
  const merged = [...sameIndustry, ...sameSector.filter((s) => !sameIndustry.includes(s))];
  return merged.slice(0, 5);
}
