import type { ReactNode } from "react";
import type { DrawingKind } from "./chart-drawings";
import type { ChartStyle } from "./chart-styles";

function Glyph({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

export function ChartStyleIcon({ style }: { style: ChartStyle }) {
  switch (style) {
    case "candles":
      return (
        <Glyph>
          <path d="M5.5 2.5v2.5M5.5 12v3.5M12.5 3.5v2M12.5 11.5v3" />
          <rect x="3.5" y="5" width="4" height="7" rx="0.6" fill="currentColor" />
          <rect x="10.5" y="5.5" width="4" height="6" rx="0.6" />
        </Glyph>
      );
    case "hollow":
      return (
        <Glyph>
          <path d="M5.5 2.5v2.5M5.5 12v3.5M12.5 3.5v2M12.5 11.5v3" />
          <rect x="3.5" y="5" width="4" height="7" rx="0.6" />
          <rect x="10.5" y="5.5" width="4" height="6" rx="0.6" />
        </Glyph>
      );
    case "bars":
      return (
        <Glyph>
          <path d="M5.5 3v12M3 6.5h2.5M5.5 12.5H8M12.5 2.5v11M10 10.5h2.5M12.5 5H15" />
        </Glyph>
      );
    case "heikin":
      return (
        <Glyph>
          <path d="M4 10v5M9 6.5v5M14 2.5v5" />
          <rect x="2.5" y="11" width="3" height="3" rx="0.5" fill="currentColor" />
          <rect x="7.5" y="7.5" width="3" height="3" rx="0.5" fill="currentColor" />
          <rect x="12.5" y="3.5" width="3" height="3" rx="0.5" fill="currentColor" />
        </Glyph>
      );
    case "line":
      return (
        <Glyph>
          <path d="M2.5 13l4-4.5 3 3L15.5 5" />
        </Glyph>
      );
    case "step":
      return (
        <Glyph>
          <path d="M2.5 13.5H6V9.5h3.5v2H12V5h3.5" />
        </Glyph>
      );
    case "area":
      return (
        <Glyph>
          <path d="M2.5 15.5V12l4-4.5 3 3 6-6v11z" fill="currentColor" fillOpacity={0.22} stroke="none" />
          <path d="M2.5 12l4-4.5 3 3 6-6" />
        </Glyph>
      );
    case "baseline":
      return (
        <Glyph>
          <path d="M2 9.5h14" strokeDasharray="1.5 2" />
          <path d="M2.5 12.5l3-4.5 3 2.5 3-6 4 3" />
        </Glyph>
      );
  }
}

export function CursorIcon() {
  return (
    <Glyph>
      <path d="M9 2.5v4.5M9 11v4.5M2.5 9H7M11 9h4.5" />
    </Glyph>
  );
}

export function DrawingIcon({ kind }: { kind: DrawingKind }) {
  switch (kind) {
    case "trend":
      return (
        <Glyph>
          <path d="M5.2 12.8l7.6-7.6" />
          <circle cx="4" cy="14" r="1.7" />
          <circle cx="14" cy="4" r="1.7" />
        </Glyph>
      );
    case "ray":
      return (
        <Glyph>
          <path d="M5.2 12.8L16 2" />
          <circle cx="4" cy="14" r="1.7" />
          <circle cx="10" cy="8" r="1.5" />
        </Glyph>
      );
    case "hline":
      return (
        <Glyph>
          <path d="M2 9h5.3M10.7 9H16" />
          <circle cx="9" cy="9" r="1.7" />
        </Glyph>
      );
    case "vline":
      return (
        <Glyph>
          <path d="M9 2v5.3M9 10.7V16" />
          <circle cx="9" cy="9" r="1.7" />
        </Glyph>
      );
    case "rect":
      return (
        <Glyph>
          <path d="M5.5 4h7M5.5 14h7M4 5.5v7M14 5.5v7" />
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="14" cy="14" r="1.5" />
        </Glyph>
      );
    case "fib":
      return (
        <Glyph>
          <path d="M2.5 3.5h13M2.5 7h13M2.5 10.5h13M2.5 14.5h13" />
          <path d="M4 14.5L14 3.5" strokeDasharray="1.5 1.8" strokeOpacity={0.7} />
        </Glyph>
      );
    case "measure":
      return (
        <Glyph>
          <path d="M9 3v12M6.5 5.5L9 3l2.5 2.5M6.5 12.5L9 15l2.5-2.5M3 9h12" />
        </Glyph>
      );
  }
}
