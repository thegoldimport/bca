import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import glassGeoBg from "@/assets/glass-geo-bg.png";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "/mo",
    description: "Publish your first app and keep it live.",
    features: [
      "1 live project",
      "BuildCustom.Ai subdomain",
      "Managed hosting, SSL, and CDN",
      "AI usage metered separately",
    ],
    cta: "Start Building",
    featured: false,
    color: "cyan"
  },
  {
    name: "Launch",
    price: "$9",
    period: "/mo",
    description: "For launching several apps with custom domains.",
    features: [
      "5 live projects",
      "Custom domains",
      "Managed hosting, SSL, and CDN",
      "BuildCustom.Ai subdomains",
      "AI usage metered separately",
    ],
    cta: "Choose Launch",
    featured: false,
    color: "cyan"
  },
  {
    name: "Pro",
    price: "$19",
    period: "/mo",
    description: "For builders running a growing app portfolio.",
    features: [
      "25 live projects",
      "Custom domains",
      "Managed hosting, SSL, and CDN",
      "BuildCustom.Ai subdomains",
      "AI usage metered separately",
    ],
    cta: "Choose Pro",
    featured: true,
    color: "purple"
  },
  {
    name: "Agency",
    price: "$49",
    period: "/mo",
    description: "For agencies managing many live customer projects.",
    features: [
      "100 live projects",
      "Custom domains",
      "Managed hosting, SSL, and CDN",
      "BuildCustom.Ai subdomains",
      "AI usage metered separately",
    ],
    cta: "Choose Agency",
    featured: false,
    color: "emerald"
  }
];

interface PricingSectionProps {
  onPlanClick?: () => void;
}

export function PricingSection({ onPlanClick }: PricingSectionProps) {
  return (
    <section className="py-24 relative overflow-hidden" id="pricing">
      {/* Background - Glass Panel Theme */}
      <div className="absolute inset-0 z-0">
         <img src={glassGeoBg} alt="Background" className="w-full h-full object-cover opacity-20" />
         <div className="absolute inset-0 bg-gradient-to-b from-[#05050a] via-cyan-900/5 to-[#05050a]" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-display font-bold text-white mb-6 drop-shadow-[0_0_15px_rgba(0,255,255,0.3)]"
          >
            Build, publish, and host in one place.
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-white/60 max-w-2xl mx-auto"
          >
            Hosting, SSL, CDN, and BuildCustom.Ai subdomains are included. AI usage is metered separately.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {PLANS.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={`relative group rounded-2xl p-8 h-full flex flex-col
                bg-gradient-to-b from-white/10 to-white/5 
                backdrop-blur-2xl 
                border-t border-l border-r border-white/20 border-b border-white/10
                shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5),inset_0_2px_0_0_rgba(255,255,255,0.2),inset_0_0_0_2px_rgba(255,255,255,0.05)]
                ${plan.featured ? "shadow-purple-500/20 border-purple-500/30" : ""}
                transition-all hover:scale-[1.02] hover:shadow-[0_30px_60px_-12px_rgba(0,0,0,0.6),inset_0_2px_0_0_rgba(255,255,255,0.3)]
              `}
            >
              {plan.featured && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full text-xs font-bold text-white uppercase tracking-wider shadow-lg">
                  Most Popular
                </div>
              )}

              <div className="mb-8">
                <h3 className={`text-xl font-bold text-${plan.color}-400 mb-2`}>{plan.name}</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-display font-bold text-white">{plan.price}</span>
                  <span className="text-white/50">{plan.period}</span>
                </div>
                <p className="text-white/60 mt-4 leading-relaxed">{plan.description}</p>
              </div>

              <div className="flex-1 mb-8">
                <ul className="space-y-4">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-white/80 text-sm">
                      <Check className={`w-5 h-5 text-${plan.color}-400 shrink-0`} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button 
                onClick={onPlanClick}
                className={`w-full h-12 rounded-xl font-bold tracking-wide transition-all ${
                  plan.featured
                    ? "bg-white text-black hover:bg-white/90"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {plan.cta}
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
