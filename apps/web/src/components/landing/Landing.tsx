import Cursor from "@/components/landing/Cursor";
import EnterScreen from "@/components/landing/EnterScreen";
import Experience from "@/components/landing/Experience";
import Header from "@/components/landing/Header";
import RedactedHero from "@/components/landing/heroes/RedactedHero";
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

/** The whole landing page. */
export default function Landing() {
  return (
    <Experience>
      <EnterScreen />
      <Header />
      <ScrollRail />
      <Cursor />
      <main id="top">
        <RedactedHero />
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
