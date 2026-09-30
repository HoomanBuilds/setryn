"use client";

import type { MouseEvent } from "react";

/** Moves keyboard focus to a landmark without scrolling past it, making it focusable only for this jump. */
function focusTarget(selector: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  };
}

/** Keyboard skip links, visible only when focused. The order ticket link appears on trading pages. */
export function SkipLinks() {
  return (
    <nav aria-label="Skip links" className="contents">
      <a href="#main" onClick={focusTarget("main")} className="skip-link">
        Skip to content
      </a>
      <a href="#order-ticket" onClick={focusTarget("#order-ticket")} className="skip-link skip-link-ticket">
        Skip to order ticket
      </a>
    </nav>
  );
}
