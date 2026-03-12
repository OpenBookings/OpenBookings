"use client";

import * as React from "react";
import { InstantSearch, useSearchBox, useHits, Configure } from "react-instantsearch";
import type { BaseHit } from "instantsearch.js";
import { searchClient, ALGOLIA_INDEX_NAME } from "@/lib/algolia";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MagnifyingGlassIcon } from "@/components/Icons";
import { CardTitle } from "./ui/card";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  className?: string;
}

interface SearchResult extends BaseHit {
  objectID: string;
  city: string;
  country: string;
}

function SearchBox({
  value,
  onChange,
  onSearch,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const { query, refine } = useSearchBox();
  const { hits } = useHits<SearchResult>();
  const [showResults, setShowResults] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastSyncedValueRef = React.useRef<string>(value);

  // Sync Algolia query when value changes externally (e.g., from result click)
  React.useEffect(() => {
    if (value !== lastSyncedValueRef.current && value !== query) {
      refine(value);
      lastSyncedValueRef.current = value;
    }
  }, [value, query, refine]);

  // Show results when there are hits and query is not empty
  React.useEffect(() => {
    setShowResults(query.length > 0 && hits.length > 0);
  }, [query, hits.length]);

  // Close results when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    
    // Update parent immediately for controlled input
    onChange(newValue);
    lastSyncedValueRef.current = newValue;
    
    // Debounce Algolia search to reduce API calls and prevent flickering
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      refine(newValue);
    }, 300); // 300ms debounce
  };

  // Cleanup debounce timer
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setShowResults(false);
    onSearch?.();
  };

  const handleResultClick = (hit: SearchResult) => {
    const displayValue = `${hit.city}, ${hit.country}`;
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    refine(displayValue);
    onChange(displayValue);
    lastSyncedValueRef.current = displayValue;
    setShowResults(false);
    onSearch?.();
  };

  return (
    <div className="relative w-full space-y-2">
      <CardTitle className="pl-4 text-xl font-semibold tracking-[0.16em] text-white/60 uppercase">
        Destination
      </CardTitle>
      <form
        className={`flex items-center gap-2 rounded-lg border shadow-sm bg-black/70 backdrop-blur-md border-white/20 px-3 py-2 ${className}`}
        onSubmit={handleFormSubmit}
        autoComplete="off"
      >
        <Input
          type="text"
          ref={inputRef}
          value={value}
          onChange={handleInput}
          onFocus={() => {
            if (value.length > 0 && hits.length > 0) {
              setShowResults(true);
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-white placeholder:text-white/50 border border-white/20"
        />
        <Button type="submit" size="icon" variant="ghost" aria-label="Search" className="text-white hover:bg-white/10">
          <MagnifyingGlassIcon />
        </Button>
      </form>

      {/* Search Results Dropdown */}
      {showResults && hits.length > 0 && (
        <div
          ref={resultsRef}
          className="absolute top-full left-0 right-0 mt-2 bg-black/50 backdrop-blur-sm border border-white/10 rounded-lg shadow-2xl max-h-96 overflow-y-auto z-50 custom-scrollbar"
        >
          {hits.map((hit: SearchResult) => (
            <button
              key={hit.objectID}
              type="button"
              onClick={() => handleResultClick(hit)}
              className="w-full px-4 py-3 text-left hover:bg-white/10 transition-colors border-b border-white/10 last:border-b-0"
            >
              <div className="font-medium text-white">{hit.city}</div>
              <div className="text-sm text-white/70">{hit.country}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  placeholder = "Search...",
  className = "",
}: SearchBarProps) {
  // Type assertion for React 19 compatibility
  const InstantSearchComponent = InstantSearch as unknown as React.ComponentType<{
    searchClient: typeof searchClient;
    indexName: string;
    children: React.ReactNode;
  }>;

  return (
    <InstantSearchComponent searchClient={searchClient} indexName={ALGOLIA_INDEX_NAME}>
      <Configure hitsPerPage={10} />
      <SearchBox
        value={value}
        onChange={onChange}
        onSearch={onSearch}
        placeholder={placeholder}
        className={className}
      />
    </InstantSearchComponent>
  );
}
