import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { LogosSection } from "@/components/logos-section";
import { ShowcaseSection } from "@/components/showcase-section";
import { FeaturesSection } from "@/components/features-section";
import { PricingSection } from "@/components/pricing-section";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#05050a] text-foreground overflow-x-hidden selection:bg-cyan-500/30">
      <Navbar />
      <main>
        <Hero />
        <LogosSection />
        <ShowcaseSection />
        <FeaturesSection />
        <PricingSection />
      </main>
      <Footer />
    </div>
  );
}
