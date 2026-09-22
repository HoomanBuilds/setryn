"use client";

import { useId, type Ref } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { QUALIFICATION_LABEL, SOURCE_LABEL, SourceMark } from "@/components/terminal/primitives";
import { formatNumber } from "@/lib/terminal/format";
import { ANY, sourceClasses, type FilterOption } from "@/lib/terminal/discovery";
import type { PackageMarket, Qualification } from "@/lib/terminal/types";

/**
 * Native select: it is keyboard and screen-reader complete on every platform,
 * and the closed control restates its dimension so five of them stay readable.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  const selected = value !== ANY;

  return (
    <span className={`relative flex min-w-0 items-center ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`focus-ring h-11 w-full min-w-0 appearance-none truncate rounded-md border bg-raised pr-7 pl-2.5 text-xs transition-colors lg:h-8 ${
          selected ? "border-brand-edge text-ink" : "border-line text-dim hover:border-line-strong"
        }`}
      >
        <option value={ANY}>{`${label}: any`}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {`${label}: ${option.label} (${option.count})`}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute right-2 shrink-0 text-faint"
      />
    </span>
  );
}

export function SearchField({
  value,
  onChange,
  inputRef,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <span className={`relative flex min-w-0 items-center ${className}`}>
      <Search
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 shrink-0 text-faint"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search markets"
        aria-label="Search package markets by name, code, underlying, strategy, tenor, settlement, or fixing source"
        className="focus-ring h-11 w-full min-w-0 rounded-md border border-line bg-raised pr-16 pl-8 text-sm text-ink transition-colors placeholder:text-off hover:border-line-strong lg:h-8 lg:text-xs"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="focus-ring absolute right-1 grid h-9 w-9 place-items-center rounded-sm text-faint transition-colors hover:text-ink lg:h-6 lg:w-6"
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 hidden rounded-sm border border-line px-1.5 text-xs text-off lg:block"
        >
          /
        </kbd>
      )}
    </span>
  );
}

const QUALIFICATION_TONE: Record<Qualification, string> = {
  QUALIFIED: "text-dim",
  CONDITIONAL: "text-brand",
  SUSPENDED: "text-down",
};

/** Qualification is a risk state, so it borrows the accent, never the up/down pair. */
export function QualificationTag({
  market,
  className = "",
}: {
  market: PackageMarket;
  className?: string;
}) {
  return (
    <span
      title={market.qualificationNote}
      className={`truncate text-xs ${QUALIFICATION_TONE[market.qualification]} ${className}`}
    >
      {QUALIFICATION_LABEL[market.qualification]}
    </span>
  );
}

/** Source classes stay monochrome: the glyph carries the class, never a colour. */
export function SourceMarks({ market }: { market: PackageMarket }) {
  const sources = sourceClasses(market);
  return (
    <span
      className="flex items-center gap-1.5 text-faint"
      title={`Executable source classes: ${sources.map((source) => SOURCE_LABEL[source]).join(", ")}`}
    >
      {sources.map((source) => (
        <SourceMark key={source} source={source} />
      ))}
    </span>
  );
}

export function PriceCell({ market }: { market: PackageMarket }) {
  return (
    <span className="tnum font-mono text-[13px] text-ink">
      {formatNumber(market.netPrice, market.priceDecimals)}
    </span>
  );
}
