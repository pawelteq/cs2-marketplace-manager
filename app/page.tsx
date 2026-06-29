"use client";

import { useEffect, useRef, useState } from "react";
import type { ComparisonResult, SearchHit } from "@/lib/types";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "EUR";

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

export default function Home() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autocomplete
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

  return (
    <main className="container">
      <div className="header">
        <h1>CS2 Marketplace Manager</h1>
        <span className="badge">porównywarka cen</span>
      </div>
      <p className="subtitle">
        Porównaj najniższe ceny skinów CS2 między marketami. Aktualnie:
        Skinport i CSFloat.
      </p>

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
                <span className="price">
                  od {fmt(h.refPrice, h.currency)}
                </span>
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

      {!result && !loading && (
        <p className="hint">
          Zacznij od wpisania nazwy skina powyżej. Podpowiedzi pochodzą z
          katalogu Skinport. CSFloat podaje ceny w USD — są przeliczane do{" "}
          {CURRENCY} wg kursu z konfiguracji (zmienna USD_TO_DEFAULT_FX).
        </p>
      )}

      <div className="footer">
        Dane: Skinport REST API + CSFloat API. Ceny mają charakter orientacyjny
        (najniższa oferta / min_price). Kolejne markety i narzędzia do
        podejmowania akcji można dodać przez interfejs MarketAdapter.
      </div>
    </main>
  );
}
