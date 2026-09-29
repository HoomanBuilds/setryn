"use client";

import { useState, type ReactNode } from "react";

export type TickDirection = "up" | "down" | null;

/**
 * Direction of the latest change in `value`. It is derived while rendering, from the previous value kept in state,
 * so the flash starts in the same frame as the new number.
 */
export function useTickDirection(value: number): TickDirection {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState<TickDirection>(null);
  if (value !== previous) {
    setPrevious(value);
    setDirection(value > previous ? "up" : "down");
  }
  return direction;
}

/**
 * Wraps a live number and flashes it toward the direction of each change. The span is keyed by the value, so every
 * tick restarts the animation instead of waiting for the previous one to finish.
 */
export function FlashValue({
  value,
  children,
  className = "",
}: {
  value: number;
  children: ReactNode;
  className?: string;
}) {
  const direction = useTickDirection(value);
  return (
    <span key={value} className={`${className} ${direction ? `flash-${direction}` : ""}`}>
      {children}
    </span>
  );
}
