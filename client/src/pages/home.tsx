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
  const [waitlistSource, setWaitlistSource] = useState("waitlist");

  const openWaitlist = (source: string = "waitlist") => {
    setWaitlistSource(source);
    setIsWaitlistOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#05050a] text-foreground overflow-x-hidden selection:bg-cyan-500/30">
      <Navbar />
      <WaitlistModal isOpen={isWaitlistOpen} onClose={() => setIsWaitlistOpen(false)} source={waitlistSource} />
      <main>
        {/* 1. Hero (Locked) */}
        <Hero onBuildClick={() => openWaitlist("waitlist")} />
        
        {/* 2. Logos (Glass Theme) */}
        <LogosSection />
        
        {/* 3. Showcase (Neon Dark Theme) - Images 50% size */}
        <ShowcaseSection />
        
        {/* 4. Pricing (Glass Theme) */}
        <PricingSection onPlanClick={() => openWaitlist("pricing")} />
        
        {/* 5. Features (Neon Dark Theme) - Moved here */}
        <FeaturesSection />
        
        {/* 6. Community (Glass/Neon Mix Theme) - New Section */}
        <CommunitySection />
        
        {/* 7. Pricing Duplicate (Neon Dark Theme - varied) */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-t from-purple-900/20 to-transparent pointer-events-none" />
          <PricingSection onPlanClick={() => openWaitlist("pricing")} />
        </div>
        
        {/* 8. Partner / Booking Section */}
        <PartnerSection onBookClick={() => openWaitlist("strategy_call")} />

        {/* 9. Hero Duplicate (Final CTA) */}
        <div className="relative border-t border-white/10">
           <Hero onBuildClick={() => openWaitlist("waitlist")} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
