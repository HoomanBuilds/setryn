"use client";

import { useId, type ReactNode, type Ref } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { QUALIFICATION_LABEL, SOURCE_LABEL, SourceMark } from "@/components/terminal/primitives";
import { formatNumber } from "@/lib/terminal/format";
import { ANY, sourceClasses, type FilterOption } from "@/lib/terminal/discovery";
import type { PackageMarket, Qualification } from "@/lib/terminal/types";

/**
 * Native select: it is keyboard and screen-reader complete on every platform,
 * and the closed control restates its dimension so several of them stay readable.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className = "",
  icon = null,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
  /** Mark for the current choice, drawn inside the closed control, for example the chosen asset. */
  icon?: ReactNode;
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
        className={`focus-ring h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border pr-7 text-xs transition-colors duration-150 lg:h-7 ${
          icon ? "pl-8" : "pl-2.5"
        } ${
          selected
            ? "border-brand-edge bg-brand-soft text-ink"
            : "border-line bg-inset text-dim hover:border-line-strong hover:text-ink"
        }`}
      >
        <option value={ANY}>{`${label}: all`}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {`${label}: ${option.label} (${option.count})`}
          </option>
        ))}
      </select>
      {icon ? <span className="pointer-events-none absolute left-2 flex">{icon}</span> : null}
      <ChevronDown
        size={12}
        aria-hidden="true"
        className={`pointer-events-none absolute right-2 shrink-0 ${selected ? "text-brand" : "text-faint"}`}
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
    <span className={`group relative flex min-w-0 items-center ${className}`}>
      <Search
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 shrink-0 text-faint transition-colors group-focus-within:text-brand"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search name, code, tenor"
        aria-label="Search package markets by name, code, underlying, strategy, tenor, settlement, or fixing source"
        className="focus-ring h-11 w-full min-w-0 rounded-md border border-line bg-inset pr-10 pl-8 text-sm text-ink transition-colors duration-150 placeholder:text-off hover:border-line-strong focus:border-brand-edge lg:h-7 lg:text-xs [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="focus-ring absolute right-1 grid h-9 w-9 place-items-center rounded-sm text-faint transition-colors hover:text-ink lg:h-5 lg:w-5"
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 hidden h-4 min-w-4 place-items-center rounded-sm border border-line px-1 font-mono text-[10px] leading-none text-off lg:grid"
        >
          /
        </kbd>
      )}
    </span>
  );
}

const QUALIFICATION_TONE: Record<Qualification, { text: string; dot: string; frame: string }> = {
  QUALIFIED: { text: "text-dim", dot: "bg-dim", frame: "border-line" },
  CONDITIONAL: { text: "text-brand", dot: "bg-brand", frame: "border-brand-edge/60 bg-brand-soft" },
  SUSPENDED: { text: "text-down", dot: "bg-down", frame: "border-down/30 bg-down-soft" },
};

/** Qualification is a risk state, so it borrows the accent, never the up/down pair for a pass. */
export function QualificationTag({
  market,
  className = "",
  bare = false,
}: {
  market: PackageMarket;
  className?: string;
  /** Text and dot only, for dense stacked rows. */
  bare?: boolean;
}) {
  const tone = QUALIFICATION_TONE[market.qualification];
  return (
    <span
      title={market.qualificationNote}
      className={`inline-flex min-w-0 items-center gap-1.5 text-[11px] leading-none whitespace-nowrap ${tone.text} ${
        bare ? "" : `h-[18px] rounded-sm border px-1.5 ${tone.frame}`
      } ${className}`}
    >
      <span aria-hidden="true" className={`h-[5px] w-[5px] shrink-0 rounded-full ${tone.dot}`} />
      <span className="truncate">{QUALIFICATION_LABEL[market.qualification]}</span>
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
