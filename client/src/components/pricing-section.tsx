import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-display font-bold text-white mb-6"
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
              className={`relative group rounded-2xl p-8 h-full flex flex-col ${
                plan.featured 
                  ? "bg-white/10 border-white/20 shadow-2xl shadow-purple-500/10" 
                  : "bg-white/5 border-white/10"
              } border backdrop-blur-xl transition-all hover:bg-white/10 hover:border-white/20`}
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
