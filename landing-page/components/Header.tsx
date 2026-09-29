"use client";

import { useRef, useState } from "react";
import { useExperience } from "@/components/Experience";
import Menu from "@/components/Menu";
import SetrynMark from "@/components/SetrynMark";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { PHASES } from "@/lib/phases";
import SoundToggle from "@/components/ui/SoundToggle";
import styles from "./Header.module.css";

const HEADER_LINE = 44;

/**
 * hatom's header: mark on the left, one dot per phase in the middle, sound
 * toggle and menu on the right. Its colours follow the section underneath.
 */
export default function Header() {
  const { stage } = useExperience();
  const root = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0);
  const [tone, setTone] = useState("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useGSAP(() => {
    ScrollTrigger.create({ start: 80, end: "max", onToggle: (self) => setScrolled(self.isActive) });
    for (const section of document.querySelectorAll<HTMLElement>("[data-theme]")) {
      ScrollTrigger.create({
        trigger: section,
        start: `top ${HEADER_LINE}px`,
        end: `bottom ${HEADER_LINE}px`,
        onToggle: (self) => self.isActive && setTone(section.dataset.theme!),
      });
    }
    for (const section of document.querySelectorAll<HTMLElement>("main [data-phase]")) {
      ScrollTrigger.create({
        trigger: section,
        start: "top 55%",
        end: "bottom 55%",
        onToggle: (self) => self.isActive && setPhase(Number(section.dataset.phase)),
      });
    }
  });

  useGSAP(
    () => {
      if (stage === "intro") return;
      gsap.fromTo(
        root.current!.children,
        { opacity: 0, y: -12 },
        { opacity: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.08, delay: 0.9 },
      );
    },
    { dependencies: [stage === "intro"], scope: root },
  );

  return (
    <>
      <header
        ref={root}
        className={styles.header}
        data-tone={tone}
        data-scrolled={scrolled || undefined}
        data-hidden={stage === "intro" || undefined}
      >
        <a href="#top" className={styles.brand} aria-label="Setryn, back to top" data-sfx="ui">
          <SetrynMark className={styles.mark} />
          <span>Setryn</span>
        </a>

        <nav className={styles.phases} aria-label="Phases">
          {PHASES.map(({ id, label }, index) => (
            <a
              key={id}
              href={`#${id}`}
              className={styles.dot}
              aria-current={index === phase ? "step" : undefined}
              aria-label={`Part ${index + 1}: ${label}`}
              data-sfx="ui"
            >
              <span className={`label ${styles.tip}`} aria-hidden="true">
                0{index + 1} {label}
              </span>
            </a>
          ))}
        </nav>

        <div className={styles.actions}>
          <SoundToggle />
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            data-sfx="ui"
          >
            Menu
          </button>
        </div>
      </header>
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
