"use client";

import { useExperience } from "@/components/landing/Experience";
import styles from "./HeroSwitcher.module.css";

export type HeroName = "shield" | "redacted" | "egg";

const OPTIONS: { name: HeroName; letter: string; label: string; href: string }[] = [
  { name: "shield", letter: "A", label: "Shield", href: "/" },
  { name: "redacted", letter: "B", label: "Redacted", href: "/b" },
  { name: "egg", letter: "C", label: "Egg", href: "/c" },
];

/**
 * Picks between the three candidate heroes while one is being chosen.
 * Plain links (full reloads), so each hero gets the enter screen and a fresh page.
 */
export default function HeroSwitcher({ current }: { current: HeroName }) {
  const { stage } = useExperience();
  return (
    <nav className={styles.switcher} aria-label="Hero options" data-hidden={stage === "intro" || undefined}>
      <span className="label">Hero</span>
      {OPTIONS.map(({ name, letter, label, href }) => (
        <a key={name} href={href} aria-current={name === current ? "page" : undefined} data-sfx="ui">
          <b className="mono">{letter}</b>
          {label}
        </a>
      ))}
    </nav>
  );
}
