"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArbitrageRow, ArbitrageSnapshot, ComparisonResult, SearchHit } from "@/lib/types";
import { filterArbitrageSnapshot, type ArbitragePage } from "@/lib/sync/arbitrage-filter";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "EUR";
const CLIENT_REFRESH_MS = 60_000;

function fmt(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

interface AppliedArbFilters {
  search: string;
  minSpreadPct: string;
  minQuantity: string;
  onlyBoth: boolean;
}

function parseFilterInt(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [arbSearch, setArbSearch] = useState("");
  const [minSpreadPct, setMinSpreadPct] = useState("5");
  const [minQuantity, setMinQuantity] = useState("5");
  const [onlyBoth, setOnlyBoth] = useState(true);
  const [applied, setApplied] = useState<AppliedArbFilters>({
    search: "",
    minSpreadPct: "5",
    minQuantity: "5",
    onlyBoth: true,
  });
  const [arbPage, setArbPage] = useState(1);
  const [snapshot, setSnapshot] = useState<
    (ArbitrageSnapshot & { nextRefreshInSec: number }) | null
  >(null);
  const [arbLoading, setArbLoading] = useState(true);
  const [arbError, setArbError] = useState<string | null>(null);
  const [arbWarning, setArbWarning] = useState<string | null>(null);
  const [refreshIn, setRefreshIn] = useState(0);
  const [spStatus, setSpStatus] = useState<{
    catalogItems: number;
    backoffActive: boolean;
    retryInSec: number;
  } | null>(null);

  const filtersDirty =
    arbSearch !== applied.search ||
    minSpreadPct !== applied.minSpreadPct ||
    minQuantity !== applied.minQuantity ||
    onlyBoth !== applied.onlyBoth;

  function applyFilters() {
    setApplied({
      search: arbSearch,
      minSpreadPct,
      minQuantity,
      onlyBoth,
    });
    setArbPage(1);
  }

  const loadSnapshot = useCallback(async () => {
    setArbLoading(true);
    setArbError(null);
    try {
      const res = await fetch("/api/arbitrage/snapshot", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd pobierania danych");
      setSnapshot(data);
      setRefreshIn(data.nextRefreshInSec ?? 60);
    } catch (e) {
      setArbError(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setArbLoading(false);
    }
  }, []);

  const arbData: ArbitragePage | null = useMemo(() => {
    if (!snapshot) return null;
    return filterArbitrageSnapshot(
      snapshot,
      {
        sort: "spreadPct",
        sortDir: "desc",
        minSpreadPct: parseFilterInt(applied.minSpreadPct, 0),
        minQuantity: parseFilterInt(applied.minQuantity, 5),
        onlyBoth: applied.onlyBoth,
        search: applied.search,
        page: arbPage,
        limit: 50,
      },
      snapshot.nextRefreshInSec,
    );
  }, [snapshot, applied, arbPage]);

  useEffect(() => {
    if (arbData?.warnings?.length) {
      setArbWarning(arbData.warnings.join(" "));
    } else {
      setArbWarning(null);
    }
  }, [arbData?.warnings]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const interval = setInterval(loadSnapshot, CLIENT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadSnapshot]);

  useEffect(() => {
    async function loadSpStatus() {
      try {
        const res = await fetch("/api/skinport/status", { cache: "no-store" });
        const data = await res.json();
        setSpStatus({
          catalogItems: data.catalogItems ?? 0,
          backoffActive: !!data.backoffActive,
          retryInSec: data.retryInSec ?? 0,
        });
      } catch {
        /* ignore */
      }
    }
    loadSpStatus();
    const interval = setInterval(loadSpStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (refreshIn <= 0) return;
    const t = setInterval(() => {
      setRefreshIn((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [refreshIn, snapshot?.lastUpdatedAt]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setHits(data.hits || []);
        setShowSuggestions(true);
        setActiveIdx(-1);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function compare(name: string) {
    setShowSuggestions(false);
    setQuery(name);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/compare?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd porównania");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || hits.length === 0) {
      if (e.key === "Enter" && query.trim()) compare(query.trim());
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = activeIdx >= 0 ? hits[activeIdx] : hits[0];
      if (hit) compare(hit.marketHashName);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  const sorted = result
    ? [...result.results].sort((a, b) => {
        const av = a.normalizedPrice ?? Infinity;
        const bv = b.normalizedPrice ?? Infinity;
        return av - bv;
      })
    : [];

  const totalPages = arbData ? Math.max(1, Math.ceil(arbData.total / arbData.limit)) : 1;

  return (
    <main className="container">
      <div className="header">
        <h1>CS2 Marketplace Manager</h1>
        <span className="badge">arbitraż Skinport vs CSFloat</span>
      </div>
      <p className="subtitle">
        Porównanie ofert Skinport vs CSFloat. Skinport: sync REST co 10 min +
        live WebSocket. CSFloat: co 1 min.
      </p>

      <section className="arb-section">
        <div className="arb-toolbar">
          <input
            type="text"
            className="arb-search"
            placeholder="Filtruj po nazwie skina…"
            value={arbSearch}
            onChange={(e) => setArbSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
          />
          <label className="filter-field">
            Min. spread %
            <input
              type="number"
              min="0"
              step="1"
              value={minSpreadPct}
              onChange={(e) => {
                setMinSpreadPct(e.target.value);
              }}
            />
          </label>
          <label className="filter-field">
            Min. sztuk (oba markety)
            <input
              type="number"
              min="1"
              step="1"
              value={minQuantity}
              onChange={(e) => {
                setMinQuantity(e.target.value);
              }}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={onlyBoth}
              onChange={(e) => setOnlyBoth(e.target.checked)}
            />
            Tylko na obu marketach
          </label>
          <button
            type="button"
            className={`apply-btn ${filtersDirty ? "apply-btn-dirty" : ""}`}
            onClick={applyFilters}
          >
            Zastosuj filtry
          </button>
        </div>

        <div className="arb-meta">
          {arbData && (
            <>
              <span>
                {arbData.total} wyników · min. {arbData.appliedFilters.minQuantity}{" "}
                szt. · spread ≥ {arbData.appliedFilters.minSpreadPct}%
                {filtersDirty && (
                  <span className="muted"> · niezastosowane zmiany</span>
                )}
              </span>
              <span>
                Ostatnia sync: <strong>{fmtTime(arbData.lastUpdatedAt)}</strong>
                {refreshIn > 0 && (
                  <span className="muted"> · kolejna za {refreshIn}s</span>
                )}
              </span>
            </>
          )}
        </div>

        {arbLoading && !snapshot && (
          <div className="spinner">Ładuję dane z Skinport i CSFloat…</div>
        )}
        {arbWarning && (
          <div className="spinner warn">{arbWarning}</div>
        )}
        {spStatus && spStatus.catalogItems === 0 && spStatus.backoffActive && (
          <div className="spinner warn">
            Skinport REST zablokowany (429). Kolejna próba sync za ~
            {Math.max(1, Math.ceil(spStatus.retryInSec / 60))} min. WebSocket
            zbiera nowe oferty na bieżąco — pełny katalog wróci po odblokowaniu API.
          </div>
        )}
        {spStatus && spStatus.catalogItems > 0 && (
          <div className="spinner subtle">
            Skinport: {spStatus.catalogItems.toLocaleString("pl-PL")} itemów w katalogu
            {spStatus.backoffActive && " (REST w backoff, dane z cache/WebSocket)"}
          </div>
        )}
        {arbError && !snapshot && (
          <div className="spinner err">Błąd: {arbError}</div>
        )}

        {arbData && (
          <div className="result arb-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Skinport</th>
                  <th>CSFloat</th>
                  <th>Spread</th>
                  <th>Taniej na</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {arbData.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted empty-row">
                      Brak wyników dla wybranych filtrów.
                    </td>
                  </tr>
                ) : (
                  arbData.rows.map((row) => (
                    <tr key={row.marketHashName}>
                      <td className="item-cell">{row.marketHashName}</td>
                      <td>
                        {row.skinport ? (
                          <>
                            <div className="price-cell">
                              {fmt(row.skinport.normalizedPrice, arbData.currency)}
                            </div>
                            <div className="muted qty">
                              {row.skinport.quantity} szt.
                            </div>
                          </>
                        ) : (
                          <span className="muted">brak</span>
                        )}
                      </td>
                      <td>
                        {row.csfloat ? (
                          <>
                            <div className="price-cell">
                              {fmt(row.csfloat.normalizedPrice, arbData.currency)}
                            </div>
                            <div className="muted qty">
                              {row.csfloat.quantity} szt. ·{" "}
                              {fmt(row.csfloat.price, "USD")} orig.
                            </div>
                          </>
                        ) : (
                          <span className="muted">brak</span>
                        )}
                      </td>
                      <td className="spread-cell">
                        {row.spread !== null && row.spreadPct !== null ? (
                          <>
                            <strong>{fmt(row.spread, arbData.currency)}</strong>
                            <div className="muted">{row.spreadPct.toFixed(1)}%</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {row.cheaperOn === "skinport" && (
                          <span className="best-tag">Skinport</span>
                        )}
                        {row.cheaperOn === "csfloat" && (
                          <span className="best-tag csfloat-tag">CSFloat</span>
                        )}
                        {!row.cheaperOn && <span className="muted">—</span>}
                      </td>
                      <td className="link-cell">
                        {row.skinport?.url && (
                          <a href={row.skinport.url} target="_blank" rel="noreferrer">
                            SP ↗
                          </a>
                        )}
                        {row.csfloat?.url && (
                          <a href={row.csfloat.url} target="_blank" rel="noreferrer">
                            CF ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                <button
                  type="button"
                  disabled={arbPage <= 1 || arbLoading}
                  onClick={() => setArbPage((p) => p - 1)}
                >
                  ← Poprzednia
                </button>
                <span className="muted">
                  Strona {arbPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={arbPage >= totalPages}
                  onClick={() => setArbPage((p) => p + 1)}
                >
                  Następna →
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <hr className="section-divider" />

      <h2 className="section-title">Porównaj pojedynczy item</h2>

      <div className="search">
        <input
          type="text"
          placeholder="Wpisz nazwę skina, np. AK-47 | Redline (Field-Tested)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => hits.length > 0 && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        />
        {showSuggestions && hits.length > 0 && (
          <div className="suggestions">
            {hits.map((h, i) => (
              <div
                key={h.marketHashName}
                className={`suggestion ${i === activeIdx ? "active" : ""}`}
                onMouseDown={() => compare(h.marketHashName)}
              >
                <span className="name">{h.marketHashName}</span>
                <span className="price">od {fmt(h.refPrice, h.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="spinner">Sprawdzam ceny na marketach…</div>}
      {error && <div className="spinner err">Błąd: {error}</div>}

      {result && !loading && (
        <div className="result">
          <div className="result-head">
            <span className="item-name">{result.marketHashName}</span>
            {result.spread !== null && result.spreadPct !== null && (
              <span className="spread">
                Różnica:{" "}
                <strong>{fmt(result.spread, result.currency)}</strong> (
                {result.spreadPct.toFixed(1)}%)
              </span>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Cena (oryg.)</th>
                <th>Cena ({result.currency})</th>
                <th>Dostępność</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isBest = r.marketId === result.bestMarketId;
                return (
                  <tr key={r.marketId} className={isBest ? "best-row" : ""}>
                    <td>
                      {r.marketName}
                      {isBest && <span className="best-tag">najtaniej</span>}
                    </td>
                    <td className="muted">
                      {r.ok ? fmt(r.price, r.currency) : "—"}
                    </td>
                    <td className="price-cell">
                      {r.ok ? (
                        fmt(r.normalizedPrice, result.currency)
                      ) : (
                        <span className="err">błąd</span>
                      )}
                    </td>
                    <td className="muted">
                      {r.quantity === null || r.quantity === undefined
                        ? "—"
                        : `${r.quantity} szt.`}
                    </td>
                    <td>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          otwórz ↗
                        </a>
                      ) : (
                        <span className="muted">brak ofert</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="footer">
        Dane: Skinport REST API (refresh ~10 min) + CSFloat price-list (refresh ~1
        min). UI odświeża się co 60 s. Ceny mają charakter orientacyjny.
      </div>
    </main>
  );
}
