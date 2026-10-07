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
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = "global-search-results";

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
        .then((response) => { setResults(response.results); setActiveIndex(response.results.length ? 0 : -1); })
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

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => results.length ? (index + 1) % results.length : -1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => results.length ? (index - 1 + results.length) % results.length : -1); }
    else if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) { event.preventDefault(); goTo(results[activeIndex]); }
  }

  return <div className={`global-search ${open ? "global-search-open" : ""}`} ref={rootRef}>
    <button className="global-search-trigger" onClick={() => setOpen(true)} aria-label="Глобальный поиск" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox">
      <Search size={16} /><span>Поиск по CRM</span><kbd>⌘ K</kbd>
    </button>
    {open ? <div className="global-search-panel">
      <div className="global-search-input-wrap"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKeyDown} placeholder="Клиент, телефон, запись, сотрудник или услуга" aria-label="Поиск по CRM" role="combobox" aria-expanded={results.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `search-option-${results[activeIndex].type}-${results[activeIndex].id}` : undefined} /><button type="button" className="icon-button" onClick={() => { setQuery(""); setOpen(false); }} aria-label="Закрыть поиск"><X size={16} /></button></div>
      {loading ? <div className="global-search-empty" role="status">Ищем совпадения…</div> : query.trim().length < 2 ? <div className="global-search-empty">Введите минимум 2 символа</div> : results.length === 0 ? <div className="global-search-empty" role="status">Ничего не найдено</div> : <div className="global-search-results" id={listId} role="listbox">{results.map((result, index) => <button type="button" role="option" aria-selected={index === activeIndex} id={`search-option-${result.type}-${result.id}`} className={`global-search-result ${index === activeIndex ? "global-search-result-active" : ""}`} key={`${result.type}-${result.id}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => goTo(result)}><span className="global-search-result-type">{typeLabels[result.type] ?? "Результат"}</span><span className="global-search-result-copy"><strong>{result.title}</strong><small>{result.subtitle ?? result.status ?? ""}</small></span></button>)}</div>}
    </div> : null}
  </div>;
}
