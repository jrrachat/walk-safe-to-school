import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, Search, X } from "lucide-react";
import type { Place } from "../shared/demo";
import { isAtlantaSchool } from "../shared/schools";
import PlaceIcon from "./PlaceIcon";
import { useSchools } from "./lib/useSchools";
export default function PlaceSearch({
  label,
  value,
  onChoose,
  onLocate,
  disabled,
  onOpenChange,
  prominent = false,
  bold = false,
}: {
  label: string;
  value: Place | null;
  onChoose: (place: Place) => void;
  onLocate?: () => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  prominent?: boolean;
  bold?: boolean;
}) {
  const places = useSchools();
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [remote, setRemote] = useState<Place[] | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null),
    request = useRef(0),
    debounce = useRef<number | null>(null);
  const localMatches = useMemo(
    () =>
      prominent
        ? places.filter((p) =>
            (p.name + " " + p.area)
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )
        : [],
    [prominent, places, query],
  );
  useEffect(
    () => () => {
      request.current++;
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    if (prominent && localMatches.length) return;
    debounce.current = window.setTimeout(() => void search(), 300);
    return () => {
      if (debounce.current !== null) window.clearTimeout(debounce.current);
      debounce.current = null;
    };
  }, [open, prominent, query, localMatches]);
  const options = useMemo(() => {
    const list = prominent
      ? [...localMatches, ...(remote || [])]
      : remote || [];
    return list
      .filter((p) => (prominent ? isAtlantaSchool(p) : true))
      .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i)
      .sort((a, b) => Number(b.kind === "School") - Number(a.kind === "School"))
      .slice(0, 6);
  }, [remote, prominent, localMatches]);
  const showResults =
    options.length > 0 || loading || Boolean(error) || remote !== null;
  function cancelSearch() {
    request.current++;
    abort.current?.abort();
    if (debounce.current !== null) window.clearTimeout(debounce.current);
    debounce.current = null;
    setLoading(false);
  }
  function closeSearch() {
    cancelSearch();
    setOpen(false);
    onOpenChange?.(false);
  }
  async function search() {
    if (query.trim().length < 2) return;
    if (prominent && localMatches.length) return;
    if (debounce.current !== null) window.clearTimeout(debounce.current);
    debounce.current = null;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/search?mode=" +
          (prominent ? "school" : "start") +
          "&q=" +
          encodeURIComponent(query.trim()),
        { signal: controller.signal },
      );
      const data = await response.json();
      if (id !== request.current) return;
      if (!response.ok) throw new Error(data.error || "Search unavailable");
      setRemote(data.places);
      setError(data.message || "");
    } catch (e) {
      if (id === request.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Search unavailable");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  return (
    <div
      className={
        "place-search " +
        (prominent ? "destination-search " : "") +
        (bold ? "bold-value" : "")
      }
    >
      <label>
        <span>{label}</span>
        <div className="search-input">
          <PlaceIcon kind={value?.kind || "Map point"} size={20} />
          <input
            aria-label={label}
            disabled={disabled}
            placeholder={
              prominent ? "Search schools" : "Search any address or place"
            }
            value={open ? query : value?.name || ""}
            onFocus={() => {
              cancelSearch();
              setOpen(true);
              onOpenChange?.(true);
              setQuery("");
              setRemote(null);
              setError("");
            }}
            onChange={(e) => {
              cancelSearch();
              setQuery(e.target.value);
              setRemote(null);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                closeSearch();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          {open ? (
            <button
              aria-label={"Close " + label + " search"}
              onClick={closeSearch}
            >
              <X size={17} />
            </button>
          ) : onLocate ? (
            <button
              disabled={disabled}
              aria-label="Use current location as starting point"
              onClick={onLocate}
            >
              <LocateFixed size={19} />
            </button>
          ) : (
            <Search size={19} />
          )}
        </div>
      </label>
      {open && showResults && (
        <div className="place-results">
          {options.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                cancelSearch();
                onChoose(p);
                setOpen(false);
                onOpenChange?.(false);
              }}
            >
              <PlaceIcon kind={p.kind} />
              <span>
                <strong>{p.name}</strong>
                <small>{p.area}</small>
              </span>
            </button>
          ))}
          {loading && <p role="status">Searching...</p>}
          {remote !== null && !options.length && !loading && (
            <p>
              {prominent ? "No matching schools." : "No matching locations."}
            </p>
          )}
          {error && <p role="status">{error}</p>}
        </div>
      )}
    </div>
  );
}
