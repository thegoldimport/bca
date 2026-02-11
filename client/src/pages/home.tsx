import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { LogosSection } from "@/components/logos-section";
import { ShowcaseSection } from "@/components/showcase-section";
import { FeaturesSection } from "@/components/features-section";
import { CommunitySection } from "@/components/community-section";
import { PricingSection } from "@/components/pricing-section";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#05050a] text-foreground overflow-x-hidden selection:bg-cyan-500/30">
      <Navbar />
      <main>
        {/* 1. Hero (Locked) */}
        <Hero />
        
        {/* 2. Logos (Glass Theme) */}
        <LogosSection />
        
        {/* 3. Showcase (Neon Dark Theme) - Images 50% size */}
        <ShowcaseSection />
        
        {/* 4. Pricing (Glass Theme) */}
        <PricingSection />
        
        {/* 5. Features (Neon Dark Theme) - Moved here */}
        <FeaturesSection />
        
        {/* 6. Community (Glass/Neon Mix Theme) - New Section */}
        <CommunitySection />
        
        {/* 7. Pricing Duplicate (Neon Dark Theme - varied) */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-t from-purple-900/20 to-transparent pointer-events-none" />
          <PricingSection />
        </div>
      </main>
      <Footer />
    </div>
  );
}
