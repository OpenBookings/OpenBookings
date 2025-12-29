"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MagnifyingGlassIcon } from "@/components/Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  placeholder = "Search...",
  className = "",
}: SearchBarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSearch?.();
  };

  return (
    <form
      className={`flex items-center gap-2 rounded-lg border shadow-sm bg-white/10 backdrop-blur-sm border-white/20 px-3 py-2 ${className}`}
      onSubmit={handleFormSubmit}
      autoComplete="off"
    >
      <Input
        type="text"
        ref={inputRef}
        value={value}
        onChange={handleInput}
        placeholder={placeholder}
        className="flex-1"
      />
      <Button type="submit" size="icon" variant="ghost" aria-label="Search">
        <MagnifyingGlassIcon />
      </Button>
    </form>
  );
}
