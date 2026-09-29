"use client";

import { useRef } from "react";
import { Arrow } from "@/components/ui/Button";
import PhaseTag from "@/components/ui/PhaseTag";
import { gsap, useGSAP } from "@/lib/gsap";
import styles from "./Problem.module.css";

const CARDS = [
  {
    glyph: "1",
    title: "Perpetuals have no expiry",
    body: "A perp can stand in for a dated hedge, but you pay funding the whole time and only learn your exit price on the day you close.",
    footer: "Perpetuals",
  },
  {
    glyph: "2",
    title: "OTC quotes can't be compared",
    body: "A desk sends one price over chat. There is no second quote next to it and no record of how the price was set.",
    footer: "OTC desks",
  },
  {
    glyph: "3",
    title: "Legs live on different venues",
    body: "A collar or a basis trade means several positions, several collateral pools and several ways for one leg to fail on its own.",
    footer: "Multi-leg trades",
  },
  {
    glyph: "4",
    title: "Large orders move public books",
    body: "Size posted on a public order book is visible before it fills, so the price moves away from you while you wait.",
    footer: "Order books",
  },
];

/**
 * Part 02 on taceo's paper: its giant headline and mint diagonal, its halftone
 * artwork, and aztec's four problem cards stepping down the page.
 */
export default function Problem() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const scrub = { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true };
        // taceo's diagonal swings flatter as the section passes.
        gsap.fromTo(
          `.${styles.diagonal}`,
          { rotation: -45, xPercent: -8, scaleX: 0.7 },
          { rotation: -24, xPercent: 12, scaleX: 1.05, ease: "none", scrollTrigger: scrub },
        );
        gsap.fromTo(`.${styles.halftoneBack}`, { yPercent: 14 }, { yPercent: -14, ease: "none", scrollTrigger: scrub });
        gsap.fromTo(`.${styles.halftoneFront}`, { yPercent: -6 }, { yPercent: 10, ease: "none", scrollTrigger: scrub });
        gsap.from(`.${styles.card}`, {
          y: 80,
          opacity: 0,
          duration: 1.1,
          ease: "power3.out",
          stagger: 0.12,
          scrollTrigger: { trigger: `.${styles.cards}`, start: "top 85%" },
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="problem" className={styles.problem} data-theme="paper" data-phase="1">
      <div className={styles.diagonal} aria-hidden="true" />

      <div className={`container ${styles.top}`}>
        <header className={styles.head}>
          <PhaseTag phase={2} tone="light">
            The problem
          </PhaseTag>
          <h2 className={styles.title} data-reveal>
            A future date is hard to hedge onchain.
          </h2>
          <p className={styles.intro} data-reveal>
            Onchain markets are built for spot swaps and perpetuals. If you know you will receive, pay or unlock tokens on
            a set date, you are left stitching venues together, trusting an OTC desk, or holding a perp whose cost you
            can&apos;t know in advance.
          </p>
        </header>

        <div className={styles.art} aria-hidden="true">
          {/* eslint-disable @next/next/no-img-element */}
          <img className={styles.halftoneBack} src="/taceo/merces-halftone-portrait-back.webp" alt="" />
          <img className={styles.halftoneFront} src="/taceo/merces-halftone-portrait-front.webp" alt="" />
          {/* eslint-enable @next/next/no-img-element */}
        </div>
      </div>

      <div className={`container ${styles.cards}`}>
        {CARDS.map(({ glyph, title, body, footer }) => (
          <article key={title} className={styles.card}>
            <header className={styles.cardHead}>
              <span className={`mono ${styles.glyph}`} aria-hidden="true">
                {glyph}
              </span>
              <h3>{title}</h3>
            </header>
            <p className={styles.cardBody}>{body}</p>
            <a href="#how" className={styles.cardFooter} data-sfx="ui">
              <span className="label">{footer}</span>
              <span className={styles.cardArrow}>
                <Arrow />
              </span>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
