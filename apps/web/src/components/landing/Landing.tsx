import Cursor from "@/components/landing/Cursor";
import EnterScreen from "@/components/landing/EnterScreen";
import Experience from "@/components/landing/Experience";
import Header from "@/components/landing/Header";
import HeroSwitcher, { type HeroName } from "@/components/landing/HeroSwitcher";
import EggHero from "@/components/landing/heroes/EggHero";
import RedactedHero from "@/components/landing/heroes/RedactedHero";
import ShieldHero from "@/components/landing/heroes/ShieldHero";
import ScrollRail from "@/components/landing/ScrollRail";
import Build from "@/components/landing/sections/Build";
import Cta from "@/components/landing/sections/Cta";
import Faq from "@/components/landing/sections/Faq";
import FieldNotes from "@/components/landing/sections/FieldNotes";
import Footer from "@/components/landing/sections/Footer";
import HowItWorks from "@/components/landing/sections/HowItWorks";
import Marquee from "@/components/landing/sections/Marquee";
import Network from "@/components/landing/sections/Network";
import Problem from "@/components/landing/sections/Problem";

const HEROES = { shield: ShieldHero, redacted: RedactedHero, egg: EggHero };

/** The whole landing page; only the hero differs between the three candidate routes. */
export default function Landing({ hero }: { hero: HeroName }) {
  const Hero = HEROES[hero];
  return (
    <Experience>
      <EnterScreen />
      <Header />
      <ScrollRail />
      <Cursor />
      <HeroSwitcher current={hero} />
      <main id="top">
        <Hero />
        <Marquee />
        <Problem />
        <HowItWorks />
        <Network />
        <Build />
        <FieldNotes />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </Experience>
  );
}
