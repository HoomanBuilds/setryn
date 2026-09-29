"use client";

import { useSyncExternalStore, type MouseEvent } from "react";
import { sound } from "@/lib/landing/sound";
import styles from "./SoundToggle.module.css";

/**
 * hatom's sound switch: "Sound" and four bars that dance while it's on. The
 * same control sits on the welcome screen and in the header. Its click is
 * kept to itself, so on the welcome screen it doesn't also enter the site.
 */
export default function SoundToggle({ className }: { className?: string }) {
  const on = useSyncExternalStore(sound.subscribe, sound.isEnabled, () => false);
  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    sound.toggle();
  };

  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ""}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Turn sound off" : "Turn sound on"}
      data-sfx="ui"
    >
      <span className={styles.label}>{on ? "Sound on" : "Sound off"}</span>
      <span className={styles.bars} data-on={on || undefined} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </button>
  );
}
