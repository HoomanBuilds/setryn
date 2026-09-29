# Setryn

A landing page for **Setryn**, the private dated-risk exchange on Arbitrum. The copy follows the Setryn product overview and presents the full product: fixed-expiry forwards, options and multi-leg strategies, public books and private RFQs, USDC clearing, the position lifecycle and receipts. Worked examples on the page (an order size, maker quotes, a receipt) are illustrative.

The visual design is built from the languages, assets and fonts of five sites: [hatom.com](https://www.hatom.com), [zk.email](https://zk.email), [taceo.io](https://taceo.io), [aztec.network](https://aztec.network) and [dymension.xyz](https://dymension.xyz).

The borrowed fonts, artwork and sounds belong to those projects, so this is for local practice only, not for deployment.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click to enter (headphones recommended).

## Assets

```bash
npm run assets              # download everything from the five live sites
npm run assets -- --check   # verify local files match what the sites serve
```

`scripts/sync-assets.mjs` reads each site's HTML, CSS and JS bundles to find the current URL of every file by name. It also follows webpack's lazily loaded chunks on zk.email, reads font files from each site's `@font-face` rules, and reads hatom's Howler sound sprites, music themes and cue files straight from its bundle into `app/data/sfx.json`. Files land in `public/<site>/` and `app/fonts/`.

Two files are derived from aztec's village painting rather than downloaded, both with sharp:
- `public/aztec/news-bg-sketch.webp`, a pen drawing (Sobel edges) for the enter screen.
- `public/aztec/news-bg-halftone.png`, a 45° mint-on-deep-green halftone in taceo's print style, for the hero's shielded layer.

## Hero candidates

Three heroes are live side by side while one is chosen. The rest of the page is identical, and a switcher at the bottom of the screen jumps between them.

| Route | Hero | Idea |
| --- | --- | --- |
| `/` | A: Shield | "Private exchange for dated risk". aztec's painting in colour as the public book, a taceo slab of halftone as the private RFQ, widening with the scroll until the scene is private, SETRYN cut out of the dots |
| `/b` | B: Redacted | "Sell 2,400 ETH on 26 March 2027", a dated order in taceo's giant type with its size redacted by a mint bar (hover to peek), and zk.email's rising card comparing a public order book with a private RFQ, a draggable divider that the scroll sweeps across |
| `/c` | C: Egg | "Risk with a date on it". Setryn's egg mark as a position, opened on one date and due on another, filled with dymension's spectrum sphere and cracking along its lime slash as you scroll to show what it pays at expiry (hatom's hatching egg) |

The heroes live in `components/heroes/`; `components/Landing.tsx` assembles the page around whichever one a route asks for.

## Hero A in detail

One idea, told in scroll. The enter screen shows the painting as a sketch, and the ink burst opens onto it in full colour: the public order book. A taceo slab crosses the scene, and inside it the same painting is printed as halftone: the private RFQ.

- **Scroll:** the stage is sticky and the scroll drives it, the way aztec's hero does. The slab widens until nothing public is left, "Private exchange" and "for dated risk" slide together from aztec's staggered layout, and SETRYN rises out of the dots as letters cut into them.
- **Readout:** a meter in hatom's bottom-right slot counts how much of the scene is private.
- **Cursor:** hatom's ink becomes a lens that shields whatever it passes over.

## What each site contributes

### hatom.com (Nuxt, three.js, GSAP, Lenis, Howler, Lottie)

- **What makes it work:** a white "Loading 5 phases" screen with a pencil-sketch scene, a counter, "Headphones recommended", a cursor reading "Click to enable sound", and an ink stain at the cursor that shows the coloured world underneath. Clicking bursts the ink open onto a dark 3D scene. The page is then split into numbered phases with lime "PHASE 01" tags, a dot per phase in the header, a sound toggle and a MENU with a caret underline. Every hover has a sound.
- **Used in Setryn:**
  - The enter screen, rebuilt in 2D with `clip-path: path()` ink blobs from `simplex-noise`, replacing the 3D, and the same ink as the hero's cursor lens.
  - The phase tags and header dots, the full-screen ink-reveal menu, and the ring cursor.
  - Smooth scrolling with Lenis.
  - Its actual sound through Howler, played the way its AudioPlayer plays it (`lib/sound.ts`):
    - the UI banks (hovers, clicks, the menu, "decoding", the burst) and the egg rollover chimes, on hover and, as on hatom, when you scroll fast;
    - its two music themes. The egg theme plays while the hero is intact and crossfades to the griffin theme once it has transformed, with hatom's 1.5 s fades at each start, loop and track end;
    - its cues at scroll moments: the egg-to-griffin transition as the hero transforms, the planet reveal on the Network planets, the armour transition as the lifecycle discs stack; each fades out if you scroll back;
    - everything muted while the tab is hidden.
  - Unlike hatom, sound is off by default and entering never turns it on. A "Sound off / Sound on" switch sits top right on the welcome screen, where the header's own switch appears after entering. Turned on before entering, the music starts 100 ms into the enter burst; turned on later, it starts straight away.
  - Its OC Mikola font for spaced labels.
  - Its planet renders, for the roles that keep the market running (makers, solvers, keepers, auditors).

### zk.email (Next.js)

- **What makes it work:** a charcoal page with a faint square grid and film grain, Newsreader serif headlines over Fustat body text, and blur-and-rise reveals. It also has an orbit diagram with pill labels and blue diamonds, a marquee between dashed rails, blueprint cards with a diamond on each corner, grainy isometric illustrations, and a quiet FAQ.
- **Used in Setryn:**
  - The grain overlay across the whole page, and the grid.
  - The marquee, which also speeds up and reverses with your scroll.
  - The How-it-settles card and step list, the "in action" cards, and the FAQ.
  - The `data-reveal` blur-in, the pill button, and its fonts, isometric art and diamond SVGs.

### taceo.io (Astro, Preact)

- **What makes it work:** Swiss-style PP Neue Montreal at huge sizes on off-white paper, neon mint labels and a mint diagonal slab, pink call-to-action labels whose arrow slides to the front on hover, hairline-bordered information cards, and mint stat boxes. It also has halftone forest artwork, a dotted mint edge above the footer, pixel-art trees, and a custom scrollbar running down the left edge.
- **Used in Setryn:**
  - The display face everywhere.
  - The hero's slab, and the halftone print style.
  - Part 02's paper section, with the diagonal (which rotates as you scroll), the halftone art on parallax and the cards.
  - The arrow-slide buttons, the Network stat boxes, the three-column connector layout for Protect, Trade and Make markets, and the left scroll rail.
  - The mint CTA with the dotted divider and the pixel trees.

### aztec.network (Webflow)

- **What makes it work:** duotone Renaissance paintings as section backgrounds, Arizona Serif with italic accent words (their "Aztec is *Alive*" heading), problem cards stepping down the page in a staircase, counters that count up, and tabs that fade in 200 ms.
- **Used in Setryn:**
  - The painting that runs through the whole story: the enter screen's drawing, the hero in colour and in halftone, and the proof card.
  - The hero's sticky, scroll-driven choreography and tone-on-tone wordmark.
  - The Network section's painted parallax background and serif headline.
  - The problem-card staircase, the counters, the step fade timing, the menu backdrop, the field-note covers, and the MD Thermochrome monospace for data.

### dymension.xyz (Next.js)

- **What makes it work:** warm black and cream, TWK Everett, and gradient-banded 3D-looking illustrations (the hub cone, stacked "rollapp" discs). It also has pin-headed frame corners, a looping Swiper coverflow blog, and a spectrum glow at the bottom of the footer.
- **Used in Setryn:**
  - Part 05's warm palette and framed product cards with its illustrations.
  - The rollapp discs stacking into a position's lifecycle (enter, adjust, roll, fix, settle, receipt) as you scroll, pinned with ScrollTrigger.
  - The field-notes coverflow, Everett for card titles, and the footer glow.

## Page structure

Sections are numbered as parts ("PART 02").

| Part | Section | Mostly from |
| --- | --- | --- |
| Intro | Enter screen | hatom + aztec art |
| 01 | Hero (one of three, above) | aztec painting and scroll, taceo slab and halftone, hatom ink lens |
| After 01 | Marquee of instrument families | zk.email |
| 02 | The problem: a future date is hard to hedge onchain | taceo paper + aztec cards |
| 03 | How it works: request, compare, settle, and who it's for | zk.email, with the hero's painting as the order card |
| 04 | Network: market facts, market roles, execution modes board | aztec + taceo boxes + hatom planets |
| 05 | Products, position lifecycle tower, field notes | dymension + taceo layout |
| After 05 | FAQ | zk.email |
| End | CTA and footer | taceo, zk.email annotations, dymension glow |

## Libraries

- **GSAP:** ScrollTrigger, SplitText, ScrambleText and `useGSAP`.
- **Lenis** for smooth scrolling.
- **Howler** for sound.
- **simplex-noise** for the ink shapes.
- **Swiper** for the coverflow.
- **next/font/local** for all fonts.
- **cheerio** and **sharp** in the asset script.

Motion respects `prefers-reduced-motion`: the enter screen fades instead of bursting, and every section renders in its finished state.

## Layout

- `app/`: layout, page, fonts, global styles, `data/sfx.json`.
- `components/`: `EnterScreen`, `Header`, `Menu`, `Cursor`, `ScrollRail`, `Experience` (Lenis, stage, sounds, reveals), `sections/*`, `ui/*`.
- `lib/`: GSAP setup, the ink-blob generator, the sound bank, the phase list.
- `scripts/sync-assets.mjs`: the asset pipeline.

The newsletter form is display-only.
