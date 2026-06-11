import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { Play, Loader2, ArrowDownAZ, AlertTriangle } from "lucide-react";
import { analyzeSymbol, type DmaResult } from "@/lib/dma/sources.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DMA-111 · Above the Line" },
      {
        name: "description",
        content:
          "Institutional 111-day moving average scanner for crypto and equities. Live data from Binance and Alpha Vantage.",
      },
      { property: "og:title", content: "DMA-111 · Above the Line" },
      {
        property: "og:description",
        content:
          "Scan crypto and stocks against their 111-day moving average. See exactly which assets sit above the trend line.",
      },
    ],
  }),
  component: Page,
});

type Kind = "crypto" | "stocks";

const DEFAULTS: Record<Kind, string> = {
  crypto:
    "BTC, ETH, XRP, BNB, SOL, TRX, DOGE, LEO, ADA, BCH, HYPE, LINK, XMR, XLM, LTC, ZEC, AVAX, HBAR, SHIB, SUI, TON, DOT, NEAR, POL, PEPE, APT, KAS, UNI, ICP, RENDER, FET, ARB, STX, IMX, OP, OKB, INJ, TIA, FIL, VET, ATOM, AR, THETA, FTM, TAO, SEI, RUNE, MNT, WLD, GRT, ALGO, FLOW, JUP, LDO, PYTH, BONK, AKT, MKR, ENA, BRETT, QNT, GALA, FLR, JASMY, XTZ, EOS, CRO, HNT, BEAM, AAVE, CORE, PENDLE, PRIME, RAY, GNO, AXS, EGLD, NEO, RON, DYDX, IOTA, CRV, CAKE, SNX, MINA, CFX, ROSE, W, STRK, BLUR, NEXO, 1INCH, ZK, POPCAT, WIF, FLOKI, GMX, ALT, AXL",
  stocks:
    "AAPL, NVDA, MSFT, AMZN, GOOGL, META, TSLA, AMD, NFLX, COIN, MSTR, PLTR, INTC, UBER, ABNB",
};

type Log = { t: string; msg: string; kind: "info" | "ok" | "warn" | "err" };

function Page() {
  const run = useServerFn(analyzeSymbol);
  const [kind, setKind] = useState<Kind>("crypto");
  const [text, setText] = useState<Record<Kind, string>>(DEFAULTS);
  const [results, setResults] = useState<DmaResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState<Log[]>([]);
  const cancelRef = useRef(false);

  const addLog = useCallback((msg: string, k: Log["kind"] = "info") => {
    setLogs((p) => [
      ...p.slice(-199),
      { t: new Date().toLocaleTimeString(), msg, kind: k },
    ]);
  }, []);

  const symbols = useMemo(
    () =>
      text[kind]
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    [text, kind],
  );

  async function execute() {
    if (running) {
      cancelRef.current = true;
      return;
    }
    cancelRef.current = false;
    setRunning(true);
    setResults([]);
    setLogs([]);
    setProgress({ done: 0, total: symbols.length });
    addLog(`Engine online · ${kind.toUpperCase()} · ${symbols.length} assets`, "ok");
    if (kind === "stocks") {
      addLog("Alpha Vantage free tier: 5 requests/min, 25/day. Throttling applied.", "warn");
    }

    const batchSize = kind === "crypto" ? 4 : 1;
    const interBatchDelayMs = kind === "crypto" ? 250 : 13_000;
    const all: DmaResult[] = [];

    for (let i = 0; i < symbols.length; i += batchSize) {
      if (cancelRef.current) {
        addLog("Aborted by operator.", "warn");
        break;
      }
      const batch = symbols.slice(i, i + batchSize);
      const settled = await Promise.all(
        batch.map((sym) => run({ data: { symbol: sym, kind } }).catch((e): DmaResult => ({
          symbol: sym,
          ok: false,
          error: e instanceof Error ? e.message : "Network error",
        }))),
      );
      for (const r of settled) {
        all.push(r);
        if (r.ok && r.dma111 != null && r.distancePct != null) {
          addLog(
            `${r.symbol.padEnd(6)} close ${fmt(r.yesterdayClose!)} · DMA ${fmt(r.dma111)} · ${r.distancePct.toFixed(2)}%`,
            r.distancePct >= 0 ? "ok" : "info",
          );
        } else {
          addLog(`${r.symbol.padEnd(6)} ${r.error}`, "err");
        }
      }
      setResults([...all]);
      setProgress({ done: Math.min(i + batch.length, symbols.length), total: symbols.length });
      if (i + batchSize < symbols.length && !cancelRef.current) {
        await sleep(interBatchDelayMs);
      }
    }

    addLog(`Run complete · ${all.filter((r) => r.ok).length}/${all.length} resolved`, "ok");
    setRunning(false);
  }

  const sorted = useMemo(
    () =>
      [...results].sort((a, b) => {
        const da = a.distancePct ?? -Infinity;
        const db = b.distancePct ?? -Infinity;
        return db - da;
      }),
    [results],
  );

  const okResults = sorted.filter((r) => r.ok);
  const bullCount = okResults.filter((r) => (r.distancePct ?? 0) >= 0).length;
  const bearCount = okResults.length - bullCount;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border/80 bg-paper/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-ink text-paper grid place-items-center font-display font-black text-lg leading-none">
              ▲
            </div>
            <span className="font-display font-black tracking-tight text-lg">DMA·111</span>
          </div>
          <nav className="hidden md:flex items-center gap-10 label">
            <a href="#scanner">Scanner</a>
            <a href="#matrix">Matrix</a>
            <a href="#stream">Stream</a>
          </nav>
          <button
            onClick={execute}
            disabled={!running && symbols.length === 0}
            className="notch-sm bg-ink text-paper font-mono text-[11px] tracking-[0.18em] uppercase px-5 py-2.5 hover:bg-accent transition-colors disabled:opacity-40"
          >
            {running ? "Abort Run" : "Initiate Scan"}
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-[1400px] mx-auto px-8 pt-20 pb-16">
        <p className="label mb-6">A retrospective 111-day moving-average scanner</p>
        <h1 className="font-display font-black uppercase tracking-[-0.03em] text-[clamp(3rem,9vw,8.5rem)] leading-[0.88]">
          ABOVE THE
          <br />
          <span className="text-muted-foreground">TRUE LINE.</span>
        </h1>
        <p className="mt-10 max-w-xl text-base text-foreground/80 leading-relaxed">
          The 111-day moving average is a quiet line in the sand. We scan it against yesterday&apos;s
          close for every asset you list — crypto via Binance, equities via Alpha Vantage — and
          rank by proximity, so the next reclaim or rejection is obvious at a glance.
        </p>

        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
          <Stat label="Universe" value={String(symbols.length)} sub={kind.toUpperCase()} />
          <Stat label="Resolved" value={`${okResults.length}/${results.length || "—"}`} />
          <Stat label="Above DMA" value={String(bullCount)} accent="bull" />
          <Stat label="Below DMA" value={String(bearCount)} accent="bear" />
        </div>
      </section>

      <main className="max-w-[1400px] mx-auto px-8 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Scanner */}
        <section id="scanner" className="lg:col-span-7 space-y-6">
          <SectionHead idx="01" title="Scanner" />
          <div className="bg-card border border-border p-6 notch">
            <div className="flex items-center gap-2 mb-5">
              {(["crypto", "stocks"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`font-mono text-[11px] tracking-[0.18em] uppercase px-4 py-2 border border-border transition-colors ${
                    kind === k
                      ? "bg-ink text-paper border-ink"
                      : "bg-transparent text-muted-foreground hover:text-ink"
                  }`}
                >
                  {k}
                </button>
              ))}
              <span className="label ml-auto">
                {kind === "crypto" ? "Source · Binance" : "Source · Alpha Vantage"}
              </span>
            </div>
            <label className="label block mb-2">Asset manifest · comma or whitespace separated</label>
            <textarea
              value={text[kind]}
              onChange={(e) => setText((p) => ({ ...p, [kind]: e.target.value }))}
              spellCheck={false}
              className="w-full h-40 bg-paper border border-border p-4 font-mono text-xs leading-relaxed focus:outline-none focus:border-ink resize-none"
              placeholder={DEFAULTS[kind]}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="label">{symbols.length} symbols queued</span>
              <button
                onClick={execute}
                disabled={!running && symbols.length === 0}
                className="notch-sm bg-accent text-accent-foreground font-mono text-[11px] tracking-[0.18em] uppercase px-6 py-3 inline-flex items-center gap-2 hover:brightness-110 disabled:opacity-40"
              >
                {running ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                {running ? "Running" : "Execute analysis"}
              </button>
            </div>
            {running && (
              <div className="mt-5">
                <div className="flex items-center justify-between label mb-2">
                  <span>Processing</span>
                  <span>
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="h-[3px] bg-muted">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Stream */}
        <section id="stream" className="lg:col-span-5 space-y-6">
          <SectionHead idx="02" title="Live Stream" />
          <div className="bg-ink text-paper border border-ink notch h-[360px] flex flex-col">
            <div className="px-5 py-3 border-b border-paper/10 flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-60">
                engine.log
              </span>
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-60 flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${running ? "bg-accent animate-pulse" : "bg-paper/30"}`}
                />
                {running ? "live" : "idle"}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 font-mono text-[11px] leading-relaxed space-y-1">
              {logs.length === 0 ? (
                <p className="opacity-40">— awaiting execution —</p>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="opacity-30 shrink-0">{l.t}</span>
                    <span
                      className={
                        l.kind === "err"
                          ? "text-[color:var(--bear)]"
                          : l.kind === "ok"
                            ? "text-[color:var(--bull)]"
                            : l.kind === "warn"
                              ? "text-accent"
                              : "text-paper/85"
                      }
                    >
                      {l.msg}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Matrix */}
        <section id="matrix" className="lg:col-span-12 space-y-6">
          <SectionHead
            idx="03"
            title="Analysis Matrix"
            right={
              <span className="label flex items-center gap-2">
                <ArrowDownAZ className="w-3.5 h-3.5" /> sorted by distance to 111-DMA
              </span>
            }
          />
          <div className="bg-card border border-border notch overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    {["Asset", "Close (yesterday)", "111-DMA", "Distance", "Signal"].map((h) => (
                      <th
                        key={h}
                        className="text-left font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-6 py-4 border-b border-border"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-32 text-center">
                        <p className="label">No data yet · run a scan</p>
                      </td>
                    </tr>
                  ) : (
                    sorted.map((r) => {
                      const dist = r.distancePct ?? 0;
                      const bull = dist >= 0;
                      return (
                        <tr key={r.symbol} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-ink text-paper grid place-items-center font-mono text-[10px] font-bold">
                                {r.symbol.slice(0, 3)}
                              </div>
                              <span className="font-display font-bold tracking-tight">
                                {r.symbol}
                              </span>
                            </div>
                          </td>
                          {r.ok ? (
                            <>
                              <td className="px-6 py-4 font-mono text-sm">
                                {fmt(r.yesterdayClose!)}
                              </td>
                              <td className="px-6 py-4 font-mono text-sm text-muted-foreground">
                                {fmt(r.dma111!)}
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`font-mono text-sm font-bold ${bull ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"}`}
                                >
                                  {bull ? "+" : ""}
                                  {dist.toFixed(2)}%
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-block font-mono text-[10px] tracking-[0.2em] uppercase px-2.5 py-1 ${
                                    bull
                                      ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                                      : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                                  }`}
                                >
                                  {bull ? "Above" : "Below"}
                                </span>
                              </td>
                            </>
                          ) : (
                            <td
                              colSpan={4}
                              className="px-6 py-4 font-mono text-xs text-[color:var(--bear)] flex items-center gap-2"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" /> {r.error}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-[1400px] mx-auto px-8 py-8 flex flex-wrap items-center justify-between gap-4 label">
          <span>© DMA·111 · retrospective signal engine</span>
          <span>binance · alpha vantage</span>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "bull" | "bear";
}) {
  return (
    <div className="bg-paper p-6">
      <p className="label">{label}</p>
      <p
        className={`mt-3 font-display font-black text-4xl tracking-tight ${
          accent === "bull"
            ? "text-[color:var(--bull)]"
            : accent === "bear"
              ? "text-[color:var(--bear)]"
              : ""
        }`}
      >
        {value}
      </p>
      {sub && <p className="label mt-1">{sub}</p>}
    </div>
  );
}

function SectionHead({
  idx,
  title,
  right,
}: {
  idx: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between border-b border-border pb-3">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[11px] tracking-[0.2em] text-accent">{idx}</span>
        <h2 className="font-display font-black uppercase tracking-tight text-2xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
