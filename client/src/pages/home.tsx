import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { LogosSection } from "@/components/logos-section";
import { ShowcaseSection } from "@/components/showcase-section";
import { FeaturesSection } from "@/components/features-section";
import { CommunitySection } from "@/components/community-section";
import { PricingSection } from "@/components/pricing-section";
import { PartnerSection } from "@/components/partner-section";
import { Footer } from "@/components/footer";
import { WaitlistModal } from "@/components/waitlist-modal";
import { useState } from "react";

export default function Home() {
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#05050a] text-foreground overflow-x-hidden selection:bg-cyan-500/30">
      <Navbar />
      <WaitlistModal isOpen={isWaitlistOpen} onClose={() => setIsWaitlistOpen(false)} />
      <main>
        {/* 1. Hero (Locked) */}
        <Hero onBuildClick={() => setIsWaitlistOpen(true)} />
        
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
        
        {/* 8. Partner / Booking Section */}
        <PartnerSection />

        {/* 9. Hero Duplicate (Final CTA) */}
        <div className="relative border-t border-white/10">
           <Hero onBuildClick={() => setIsWaitlistOpen(true)} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
