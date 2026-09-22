"use client";

import { ChevronDown } from "lucide-react";

/**
 * Narrow widths get one control, not four segments: the closed select restates
 * its dimension, so the active choice reads in full with nothing clipped.
 */
export function DimensionSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="relative flex min-w-0 shrink items-center">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="focus-ring h-11 w-full min-w-0 appearance-none truncate rounded-md border border-line bg-raised pr-8 pl-3 text-ink transition-colors hover:border-line-strong"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {`${label}: ${option.label}`}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 shrink-0 text-faint"
      />
    </span>
  );
}

/** One row of view chrome above a surface: control on the left, count on the right. */
export function ControlRow({
  children,
  note,
}: {
  children: React.ReactNode;
  note: string;
}) {
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-panel px-3 lg:h-12 lg:px-4">
      {children}
      <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-faint">{note}</span>
    </div>
  );
}
