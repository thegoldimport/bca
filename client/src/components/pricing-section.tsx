import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import glassGeoBg from "@/assets/glass-geo-bg.png";

const PLANS = [
  {
    name: "Hobby",
    price: "$0",
    period: "/mo",
    description: "Perfect for testing ideas and building small tools.",
    features: [
      "Unlimited public projects",
      "5 AI generations per day",
      "Community support",
      "Standard speed",
      "Subdomain deployment"
    ],
    cta: "Start Building",
    featured: false,
    color: "cyan"
  },
  {
    name: "Pro",
    price: "$29",
    period: "/mo",
    description: "For serious builders who want power and privacy.",
    features: [
      "Unlimited private projects",
      "Unlimited AI generations",
      "Priority support",
      "Fastest generation speed",
      "Custom domain deployment",
      "Database access",
      "Export code"
    ],
    cta: "Go Pro",
    featured: true,
    color: "purple"
  },
  {
    name: "Team",
    price: "Custom",
    period: "",
    description: "For teams building production-grade software.",
    features: [
      "Everything in Pro",
      "Shared workspace",
      "Admin controls",
      "SSO & Audit logs",
      "Dedicated support",
      "SLA guarantee"
    ],
    cta: "Contact Sales",
    featured: false,
    color: "emerald"
  }
];

export function PricingSection() {
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
            Pick your vibe.
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-white/60 max-w-2xl mx-auto"
          >
            Start for free, scale when you're ready. No hidden fees.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
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
