import styles from "./PhaseTag.module.css";

/** hatom's lime numbered tag ("PART 01" here), then a taceo-style outlined label. */
export default function PhaseTag({ phase, children, tone = "dark" }: { phase: number; children: string; tone?: "dark" | "light" }) {
  return (
    <div className={styles.tag} data-tone={tone} data-reveal>
      <span className={`label ${styles.phase}`}>Part 0{phase}</span>
      <span className={`label ${styles.name}`}>{children}</span>
    </div>
  );
}
