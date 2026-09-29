"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useExperience } from "@/components/landing/Experience";
import SetrynMark from "@/components/landing/SetrynMark";
import { gsap, useGSAP } from "@/lib/landing/gsap";
import { inkBlob, inkDroplets, withHoles } from "@/lib/landing/ink";
import SoundToggle from "@/components/landing/ui/SoundToggle";
import { sound } from "@/lib/landing/sound";
import styles from "./EnterScreen.module.css";

/** Files the first screens need, loaded while the counter runs (hatom's "Loading 5 phases"). */
const PRELOAD = [
  "/aztec/news-bg-sketch.webp",
  "/aztec/news-bg.webp",
  "/aztec/news-bg-halftone.png",
  "/zkemail/noise.jpg",
];

const MIN_LOADING_SECONDS = 1.6;
const CURSOR_RADIUS = 78;
const RING_LENGTH = 2 * Math.PI * 29;

/**
 * hatom.com's enter screen, rebuilt in 2D: a pen drawing on paper, an ink
 * stain at the cursor that shows the painting underneath, a loading counter,
 * and a click that bursts the ink open onto the page.
 */
export default function EnterScreen() {
  const { stage, setStage } = useExperience();
  const root = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  // Loading: images and fonts, never faster than MIN_LOADING_SECONDS.
  useEffect(() => {
    const counter = { value: 0 };
    const total = PRELOAD.length + 1;
    let loaded = 0;
    const started = performance.now();
    const advance = () => {
      loaded++;
      const elapsed = (performance.now() - started) / 1000;
      gsap.to(counter, {
        value: (loaded / total) * 100,
        duration: loaded === total ? Math.max(0.5, MIN_LOADING_SECONDS - elapsed) : 0.6,
        ease: "power2.out",
        overwrite: true,
        onUpdate: () => setProgress(Math.round(counter.value)),
        onComplete: () => loaded === total && setReady(true),
      });
    };
    for (const src of PRELOAD) {
      const image = new Image();
      image.onload = image.onerror = advance;
      image.src = src;
    }
    document.fonts.ready.then(advance);
    return () => {
      gsap.killTweensOf(counter);
    };
  }, []);

  const { contextSafe } = useGSAP(
    () => {
      const overlay = root.current!;
      const art = overlay.querySelector<HTMLElement>(`.${styles.art}`)!;
      const colour = overlay.querySelector<HTMLElement>(`.${styles.colour}`)!;
      const cursor = overlay.querySelector<HTMLElement>(`.${styles.cursor}`)!;
      const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

      // Hand-drawn intro: the sketch fades up, the mark draws with the counter.
      gsap.from(art, { opacity: 0, scale: 0.96, duration: 1.4, ease: "power2.out" });
      gsap.from(overlay.querySelectorAll(`.${styles.edge}`), { opacity: 0, y: 8, duration: 1, stagger: 0.1, delay: 0.3 });

      // The ink stain: follows the pointer on desktop, wanders by itself on touch.
      const target = { x: innerWidth / 2, y: innerHeight / 2, radius: finePointer ? 0 : CURSOR_RADIUS };
      const ink = { ...target, time: Math.random() * 10 };
      const moveCursor = {
        x: gsap.quickTo(cursor, "x", { duration: 0.35, ease: "power3.out" }),
        y: gsap.quickTo(cursor, "y", { duration: 0.35, ease: "power3.out" }),
      };
      const onMove = (event: PointerEvent) => {
        target.x = event.clientX;
        target.y = event.clientY;
        target.radius = CURSOR_RADIUS;
        moveCursor.x(event.clientX);
        moveCursor.y(event.clientY);
      };
      const onLeave = () => (target.radius = 0);
      if (finePointer) {
        overlay.addEventListener("pointermove", onMove);
        overlay.addEventListener("pointerleave", onLeave);
      }

      const tick = (_time: number, deltaMs: number) => {
        const dt = Math.min(deltaMs, 50) / 1000;
        ink.time += dt * 0.6;
        if (!finePointer) {
          target.x = innerWidth / 2 + Math.cos(ink.time * 0.9) * innerWidth * 0.22;
          target.y = innerHeight / 2 + Math.sin(ink.time * 1.4) * innerHeight * 0.14;
        }
        const ease = 1 - Math.exp(-dt * 9);
        ink.x += (target.x - ink.x) * ease;
        ink.y += (target.y - ink.y) * ease;
        ink.radius += (target.radius - ink.radius) * ease;
        const box = art.getBoundingClientRect();
        const scale = box.width / art.offsetWidth;
        colour.style.clipPath =
          ink.radius < 1
            ? "circle(0)"
            : `path("${inkBlob((ink.x - box.left) / scale, (ink.y - box.top) / scale, ink.radius / scale, ink.time, { wobble: 0.16, spikes: 0.35, seed: 1.7 })}")`;
      };
      gsap.ticker.add(tick);

      return () => {
        gsap.ticker.remove(tick);
        overlay.removeEventListener("pointermove", onMove);
        overlay.removeEventListener("pointerleave", onLeave);
      };
    },
    { scope: root },
  );

  const burst = contextSafe((overlay: HTMLDivElement, x: number, y: number) => {
    const ring = overlay.querySelector<SVGCircleElement>(`.${styles.ringProgress}`)!;
    const art = overlay.querySelector<HTMLElement>(`.${styles.art}`)!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    sound.play("Quick_Buildup");

    if (reduced) {
      setStage("revealing");
      gsap.to(overlay, { opacity: 0, duration: 0.5, onComplete: () => setStage("entered") });
      return;
    }

    const { innerWidth: width, innerHeight: height } = window;
    const burst = { radius: 0, time: 0 };
    const farthest = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    const timeline = gsap.timeline();
    timeline
      .to(ring, { strokeDashoffset: 0, duration: 0.5, ease: "power1.in" })
      .add(() => {
        sound.play("ExpSFX_In");
        setStage("revealing");
      })
      .to(burst, {
        radius: farthest * 1.25,
        time: 1.2,
        duration: 1.6,
        ease: "power3.in",
        onUpdate: () => {
          const hole = inkBlob(x, y, burst.radius, burst.time, { wobble: 0.2, spikes: 0.9, seed: 4.2 });
          overlay.style.clipPath = withHoles(width, height, hole + inkDroplets(x, y, burst.radius, 18, 3));
        },
      })
      .to(art, { scale: 1.08, duration: 1.6, ease: "power2.in" }, "<")
      .add(() => setStage("entered"));
  });

  if (stage === "entered") return null;

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!ready || stage !== "intro") return;
    // Keyboard "clicks" have no position; burst from the centre.
    const fromPointer = event.detail > 0;
    burst(
      event.currentTarget,
      fromPointer ? event.clientX : innerWidth / 2,
      fromPointer ? event.clientY : innerHeight / 2,
    );
  };

  return (
    <div
      ref={root}
      className={styles.overlay}
      data-ready={ready || undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Enter Setryn"
      onClick={onClick}
    >
      <p className={`label ${styles.edge} ${styles.top}`}>Loading 5 parts</p>

      <div className={styles.art} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.sketch} src="/aztec/news-bg-sketch.webp" alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.colour} src="/aztec/news-bg.webp" alt="" />
      </div>

      <div className={styles.center}>
        <span className={`label ${styles.count}`} aria-hidden="true">
          {progress}
        </span>
        <SetrynMark className={styles.mark} style={{ ["--draw" as string]: progress / 100 }} />
        <button type="button" className={`label ${styles.count} ${styles.enter}`} disabled={!ready}>
          {ready ? "Click to enter" : progress}
        </button>
      </div>

      <p className={`label ${styles.edge} ${styles.bottom}`}>Headphones recommended</p>

      {/* Sound is off until you turn it on here or in the header; entering never switches it on. */}
      <div className={styles.soundCorner}>
        <SoundToggle />
      </div>

      <div className={styles.cursor} aria-hidden="true">
        <svg className={styles.ring} viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="29" />
          <circle
            className={styles.ringProgress}
            cx="32"
            cy="32"
            r="29"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH}
          />
        </svg>
        <span className={styles.cursorText}>{ready ? "Click to enter" : "Loading"}</span>
      </div>
    </div>
  );
}
