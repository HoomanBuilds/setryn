"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/landing/gsap";
import styles from "./Marquee.module.css";

const ITEMS = [
  "Forwards",
  "Capped forwards",
  "Non-deliverable forwards",
  "Calls and puts",
  "Collars",
  "Option spreads",
  "Basis and carry",
  "Funding-rate markets",
  "Calendar spreads",
  "N-leg packages",
];

/** zk.email's use-case marquee (dashed rails, blue diamonds), pushed along by the scroll. */
export default function Marquee() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const loop = gsap.to(`.${styles.track}`, { xPercent: -50, duration: 38, ease: "none", repeat: -1 });
        ScrollTrigger.create({
          trigger: root.current,
          start: "top bottom",
          end: "bottom top",
          onUpdate: (self) => {
            const boost = Math.min(Math.abs(self.getVelocity()) / 250, 7);
            gsap.to(loop, {
              timeScale: self.direction * (1 + boost),
              duration: 0.25,
              overwrite: true,
              onComplete: () => void gsap.to(loop, { timeScale: self.direction, duration: 1.2 }),
            });
          },
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );

  const run = (copy: number) =>
    ITEMS.map((item) => (
      <span key={`${copy}-${item}`} className={styles.item} aria-hidden={copy > 0 || undefined}>
        {item}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/zkemail/MarqueeSeparator.svg" alt="" width={20} height={20} />
      </span>
    ));

  return (
    <div ref={root} className={styles.marquee}>
      <div className={styles.track}>
        {run(0)}
        {run(1)}
      </div>
    </div>
  );
}
