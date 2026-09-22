export interface SummaryMetric {
  label: string;
  value: string;
  note: string;
  valueTone?: string;
  noteTone?: string;
}

/* The rules run between the figures rather than around them, so the 2x2 phone
   grid and the 4-up desktop strip both read as one panel instead of cards. */
const EDGES = [
  "",
  "border-l",
  "border-t lg:border-t-0 lg:border-l",
  "border-t border-l lg:border-t-0",
];

export function SummaryStrip({ metrics }: { metrics: SummaryMetric[] }) {
  return (
    <div className="grid shrink-0 grid-cols-2 border-b border-line bg-panel lg:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`flex min-w-0 flex-col gap-1 border-line-soft px-3 py-3 lg:px-5 lg:py-4 ${EDGES[index]}`}
        >
          <span className="truncate text-xs text-faint">{metric.label}</span>
          <span
            className={`tnum truncate font-mono text-sm lg:text-base ${metric.valueTone ?? "text-ink"}`}
          >
            {metric.value}
          </span>
          <span className={`truncate text-xs ${metric.noteTone ?? "text-off"}`}>{metric.note}</span>
        </div>
      ))}
    </div>
  );
}
