"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/lib/api-client";

type SearchResult = { id: string; title: string; subtitle: string | null; type: string; href: string; status?: string };
type SearchResponse = { ok: true; results: SearchResult[] };

const typeLabels: Record<string, string> = { client: "Клиент", appointment: "Запись", employee: "Сотрудник", service: "Услуга" };

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    function closeOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", handleShortcut);
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("keydown", handleShortcut);
      document.removeEventListener("mousedown", closeOutside);
    };
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((response) => setResults(response.results))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  function goTo(result: SearchResult) {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  }

  return <div className={`global-search ${open ? "global-search-open" : ""}`} ref={rootRef}>
    <button className="global-search-trigger" onClick={() => setOpen(true)} aria-label="Глобальный поиск">
      <Search size={16} /><span>Поиск по CRM</span><kbd>⌘ K</kbd>
    </button>
    {open ? <div className="global-search-panel">
      <div className="global-search-input-wrap"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, телефон, запись, сотрудник или услуга" /><button className="icon-button" onClick={() => { setQuery(""); setOpen(false); }} aria-label="Закрыть поиск"><X size={16} /></button></div>
      {loading ? <div className="global-search-empty">Ищу совпадения…</div> : query.trim().length < 2 ? <div className="global-search-empty">Введите минимум 2 символа</div> : results.length === 0 ? <div className="global-search-empty">Ничего не найдено</div> : <div className="global-search-results">{results.map((result) => <button className="global-search-result" key={`${result.type}-${result.id}`} onClick={() => goTo(result)}><span className="global-search-result-type">{typeLabels[result.type] ?? "Результат"}</span><span className="global-search-result-copy"><strong>{result.title}</strong><small>{result.subtitle ?? result.status ?? ""}</small></span></button>)}</div>}
    </div> : null}
  </div>;
}
