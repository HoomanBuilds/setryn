"use client";

import { useRef } from "react";
import { useExperience } from "@/components/Experience";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";
import styles from "./ScrollRail.module.css";

/** taceo.io's custom scrollbar: a hairline down the left edge with a solid thumb. */
export default function ScrollRail() {
  const { stage } = useExperience();
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const rail = root.current!;
      const thumb = rail.firstElementChild as HTMLElement;
      const setY = gsap.quickSetter(thumb, "y", "px");
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => setY(self.progress * (rail.clientHeight - thumb.offsetHeight)),
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className={styles.rail} data-hidden={stage === "intro" || undefined} aria-hidden="true">
      <span className={styles.thumb} />
    </div>
  );
}
