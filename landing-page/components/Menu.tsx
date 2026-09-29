"use client";

import { useEffect, useRef } from "react";
import { getLenis } from "@/components/Experience";
import { gsap, useGSAP } from "@/lib/gsap";
import { inkBlob } from "@/lib/ink";
import { PHASES } from "@/lib/phases";
import { sound } from "@/lib/sound";
import styles from "./Menu.module.css";

const SOCIALS = ["X", "GitHub", "Discord", "Telegram"];

/** hatom's full-screen menu, opened by an ink stain spreading from the Menu button. */
export default function Menu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  // The section a menu link asked for; scrolled to once the menu has closed.
  const pending = useRef<string | null>(null);

  useGSAP(
    () => {
      const menu = root.current!;
      if (open === wasOpen.current) return;
      wasOpen.current = open;

      const origin = document.querySelector<HTMLElement>("[aria-controls='site-menu']")!.getBoundingClientRect();
      const [x, y] = [origin.left + origin.width / 2, origin.top + origin.height / 2];
      const farthest = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const ink = { radius: open ? 0 : farthest * 1.3, time: 0 };
      const draw = () => {
        menu.style.clipPath = `path("${inkBlob(x, y, ink.radius, ink.time, { wobble: 0.14, spikes: 0.5, seed: 8 })}")`;
      };

      sound.play(open ? "MenuSFX_In" : "MenuSFX_Out");
      if (open) {
        getLenis()?.stop();
        gsap.set(menu, { visibility: "visible" });
        draw();
        gsap.to(ink, { radius: farthest * 1.3, time: 1, duration: 1.1, ease: "power3.inOut", onUpdate: draw });
        gsap.fromTo(
          menu.querySelectorAll("[data-menu-item]"),
          { yPercent: 110, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 0.9, ease: "power3.out", stagger: 0.05, delay: 0.35 },
        );
        menu.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
      } else {
        gsap.to(ink, {
          radius: 0,
          time: 1,
          duration: 0.8,
          ease: "power3.inOut",
          onUpdate: draw,
          onComplete: () => {
            gsap.set(menu, { visibility: "hidden" });
            getLenis()?.start();
            if (pending.current) getLenis()?.scrollTo(pending.current, { duration: 1.6 });
            pending.current = null;
          },
        });
        document.querySelector<HTMLElement>("[aria-controls='site-menu']")?.focus({ preventScroll: true });
      }
    },
    { dependencies: [open], scope: root },
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      ref={root}
      id="site-menu"
      className={styles.menu}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      aria-hidden={!open}
      inert={!open}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.backdrop} src="/aztec/sandbox-bg.webp" alt="" />
      <button type="button" className={styles.close} onClick={onClose} data-sfx="ui">
        Close
      </button>

      <nav className={styles.links} aria-label="Sections">
        {PHASES.map(({ id, label }, index) => (
          <div key={id} className={styles.row}>
            <a
              href={`#${id}`}
              className={styles.link}
              onClick={(event) => {
                event.preventDefault();
                pending.current = `#${id}`;
                onClose();
              }}
              data-menu-item
              data-sfx="ui"
            >
              <span className={`mono ${styles.index}`}>0{index + 1}</span>
              <span className={styles.text}>{label}</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </a>
          </div>
        ))}
      </nav>

      <div className={styles.aside}>
        <div className={styles.row}>
          <p className="label" data-menu-item>
            Say hello
          </p>
        </div>
        <div className={styles.row}>
          <p className={styles.mail} data-menu-item>
            hello@setryn.example
          </p>
        </div>
        <ul className={styles.socials}>
          {SOCIALS.map((name) => (
            <li key={name} className={styles.row}>
              <a href="#" data-menu-item data-sfx="ui">
                {name} ↗
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
