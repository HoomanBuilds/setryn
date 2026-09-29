"use client";

import { useRef } from "react";
import { useExperience } from "@/components/landing/Experience";
import { gsap, useGSAP } from "@/lib/landing/gsap";
import styles from "./Cursor.module.css";

/**
 * hatom's trailing ring cursor. It grows and shows a caption over elements
 * with data-cursor="…" (e.g. "Listen" on the planets), and steps aside over
 * data-cursor="none". Mouse only.
 */
export default function Cursor() {
  const { stage } = useExperience();
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(hover: hover) and (pointer: fine)", () => {
        const cursor = root.current!;
        const caption = cursor.querySelector<HTMLElement>(`.${styles.caption}`)!;
        const x = gsap.quickTo(cursor, "x", { duration: 0.45, ease: "power3.out" });
        const y = gsap.quickTo(cursor, "y", { duration: 0.45, ease: "power3.out" });
        const move = (event: PointerEvent) => {
          x(event.clientX);
          y(event.clientY);
          cursor.dataset.visible = "";
        };
        const over = (event: PointerEvent) => {
          const target = (event.target as Element).closest<HTMLElement>("[data-cursor], a, button");
          const text = target?.dataset.cursor ?? "";
          caption.textContent = text === "none" ? "" : text;
          // data-cursor="none": the area draws its own cursor (the hero's ink lens).
          if (text === "none") cursor.dataset.mode = "hidden";
          else if (text) cursor.dataset.mode = "label";
          else if (target) cursor.dataset.mode = "link";
          else delete cursor.dataset.mode;
        };
        const leave = () => delete cursor.dataset.visible;
        window.addEventListener("pointermove", move);
        document.addEventListener("pointerover", over);
        document.documentElement.addEventListener("pointerleave", leave);
        return () => {
          window.removeEventListener("pointermove", move);
          document.removeEventListener("pointerover", over);
          document.documentElement.removeEventListener("pointerleave", leave);
        };
      });
      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className={styles.cursor} data-hidden={stage === "intro" || undefined} aria-hidden="true">
      <span className={styles.ring} />
      <span className={`label ${styles.caption}`} />
    </div>
  );
}
