"use client";

import { useId, useState } from "react";
import Button from "@/components/landing/ui/Button";
import { APP_LINKS } from "@/lib/landing/app-links";
import styles from "./Faq.module.css";

const QUESTIONS = [
  {
    q: "What is Setryn?",
    a: "An exchange and clearing protocol for dated risk, built for Arbitrum One. It trades fixed-expiry forwards, options, rate and basis markets and multi-leg strategies on one instrument model, clears them against native USDC, and manages each position until it settles.",
  },
  {
    q: "Is it live on mainnet?",
    a: "Not yet. The exchange runs end to end on a local devnet today. Next is a public release candidate on Arbitrum Sepolia with test assets, then a capped Arbitrum One launch with native USDC. No figure on this page is a mainnet balance or volume.",
  },
  {
    q: "Is it a perp DEX with privacy added?",
    a: "No. Perpetuals have no expiry. Every Setryn instrument has a fixed date, a published fixing rule and a payout you can calculate in advance. Privacy is one part of how orders are executed, not the whole product.",
  },
  {
    q: "Where does the liquidity come from?",
    a: "A public order book, firm quotes from qualified makers, private RFQs, auctions and solvers. Every quote shows its all-in price, size, fees, expiry and whether it is firm or indicative, and indicative prices are never counted as firm depth.",
  },
  {
    q: "What do I need as collateral?",
    a: "Native USDC on Arbitrum One, issued by Circle rather than bridged. Most contracts are cash-settled in USDC, so the asset you are hedging, whether gold, euros or BTC, does not need its own token on the chain.",
  },
  {
    q: "How are fixing and settlement decided?",
    a: "Each market publishes its benchmark, observation window, calendar and fallback rules before it lists. At expiry the position fixes from those rules and settles in USDC. Options are exercised at the holder's election, and anyone can complete settlement from the committed state.",
  },
  {
    q: "What if an operator goes offline or pauses the market?",
    a: "A guardian can pause new risk, but it cannot move funds, change a market's economics or block exits. Settlement and claims are permissionless, so existing positions and collateral always have a way to finish.",
  },
];

/** zk.email's FAQ: a quiet two-column accordion with blue diamond markers. */
export default function Faq() {
  const [open, setOpen] = useState(0);
  const id = useId();

  return (
    <section className={styles.faq} data-theme="dark">
      <div className={`container ${styles.inner}`}>
        <div className={styles.intro}>
          <h2 className={styles.title} data-reveal>
            Questions
          </h2>
          <p data-reveal>Short answers to what treasuries, traders and makers ask first. The markets page lists every maturity in the preview.</p>
          <div data-reveal>
            <Button href={APP_LINKS.markets} variant="pill">
              Browse the markets
            </Button>
          </div>
        </div>

        <ul className={styles.list}>
          {QUESTIONS.map(({ q, a }, index) => {
            const expanded = open === index;
            return (
              <li key={q} className={styles.item} data-open={expanded || undefined} data-reveal>
                <button
                  type="button"
                  className={styles.question}
                  aria-expanded={expanded}
                  aria-controls={`${id}-${index}`}
                  onClick={() => setOpen(expanded ? -1 : index)}
                  data-sfx="ui"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/zkemail/BlueDiamondOutlined.svg" alt="" width={12} height={12} />
                  <span>{q}</span>
                  <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
                <div id={`${id}-${index}`} className={styles.answer} role="region" aria-hidden={!expanded}>
                  <div>
                    <p>{a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
