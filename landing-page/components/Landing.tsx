import Cursor from "@/components/Cursor";
import EnterScreen from "@/components/EnterScreen";
import Experience from "@/components/Experience";
import Header from "@/components/Header";
import HeroSwitcher, { type HeroName } from "@/components/HeroSwitcher";
import EggHero from "@/components/heroes/EggHero";
import RedactedHero from "@/components/heroes/RedactedHero";
import ShieldHero from "@/components/heroes/ShieldHero";
import ScrollRail from "@/components/ScrollRail";
import Build from "@/components/sections/Build";
import Cta from "@/components/sections/Cta";
import Faq from "@/components/sections/Faq";
import FieldNotes from "@/components/sections/FieldNotes";
import Footer from "@/components/sections/Footer";
import HowItWorks from "@/components/sections/HowItWorks";
import Marquee from "@/components/sections/Marquee";
import Network from "@/components/sections/Network";
import Problem from "@/components/sections/Problem";

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
