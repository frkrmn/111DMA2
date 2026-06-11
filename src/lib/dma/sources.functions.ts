import { createServerFn } from "@tanstack/react-start";

export type Bar = { time: number; close: number };

export type DmaResult = {
  symbol: string;
  ok: boolean;
  yesterdayClose?: number;
  dma111?: number;
  distancePct?: number;
  error?: string;
};

function analyzeDMA(bars: Bar[], offset: number): { yesterdayClose: number; dma111: number } {
  if (bars.length < 112) throw new Error(`Insufficient history (${bars.length})`);
  const yIdx = bars.length - 1 - offset;
  if (yIdx < 110) throw new Error(`Insufficient history before yesterday`);
  const yesterdayClose = bars[yIdx].close;
  const slice = bars.slice(yIdx - 110, yIdx + 1);
  const dma111 = slice.reduce((s, b) => s + b.close, 0) / 111;
  return { yesterdayClose, dma111 };
}

// ---------- Binance (crypto) ----------
async function binanceKlines(symbol: string): Promise<Bar[]> {
  const pair = `${symbol.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=130`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) throw new Error(`Unknown symbol ${symbol}/USDT`);
    if (res.status === 418 || res.status === 429) throw new Error("Rate limit (Binance)");
    throw new Error(`Binance ${res.status}`);
  }
  const json = (await res.json()) as unknown[];
  return json.map((k) => {
    const row = k as (string | number)[];
    return { time: Math.floor(Number(row[0]) / 1000), close: Number(row[4]) };
  });
}

// ---------- Alpha Vantage (stocks) ----------
async function alphaVantageDaily(symbol: string, apiKey: string): Promise<Bar[]> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json["Error Message"]) throw new Error(`Unknown symbol ${symbol}`);
  if (json["Note"]) throw new Error("Rate limit (Alpha Vantage, 5/min · 25/day)");
  if (json["Information"]) throw new Error(String(json["Information"]).slice(0, 90));
  const series = json["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
  if (!series) throw new Error("No data");
  const bars: Bar[] = Object.entries(series)
    .map(([date, row]) => ({ time: Date.parse(date) / 1000, close: Number(row["4. close"]) }))
    .sort((a, b) => a.time - b.time);
  return bars;
}

export const analyzeSymbol = createServerFn({ method: "POST" })
  .inputValidator((d: { symbol: string; kind: "crypto" | "stocks" }) => d)
  .handler(async ({ data }): Promise<DmaResult> => {
    try {
      let bars: Bar[];
      let offset: number;
      if (data.kind === "crypto") {
        bars = await binanceKlines(data.symbol);
        offset = 1; // last bar = today (incomplete)
      } else {
        const key = process.env.ALPHAVANTAGE_API_KEY;
        if (!key) throw new Error("ALPHAVANTAGE_API_KEY not configured");
        bars = await alphaVantageDaily(data.symbol, key);
        offset = 0; // last bar = last completed trading day
      }
      const { yesterdayClose, dma111 } = analyzeDMA(bars, offset);
      const distancePct = ((yesterdayClose - dma111) / dma111) * 100;
      return { symbol: data.symbol, ok: true, yesterdayClose, dma111, distancePct };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { symbol: data.symbol, ok: false, error: msg };
    }
  });
