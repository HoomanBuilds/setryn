import Button from "@/components/landing/ui/Button";
import { APP_LINKS } from "@/lib/landing/app-links";
import styles from "./Cta.module.css";

/** taceo's closing call: mint, its dotted edge, big type, pink button and pixel trees. */
export default function Cta() {
  return (
    <section className={styles.cta} data-theme="mint">
      <div className={styles.dots} aria-hidden="true" />
      <div className={`container ${styles.inner}`}>
        <h2 className={styles.title} data-reveal>
          Have a date
          <br />
          to hedge?
        </h2>
        <div className={styles.actions} data-reveal>
          <Button href={APP_LINKS.trade}>Start trading</Button>
          <Button href="mailto:makers@setryn.example" variant="outline">
            Make markets with us
          </Button>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.trees} src="/taceo/merces-mainnet-announcement.svg" alt="" aria-hidden="true" />
    </section>
  );
}
