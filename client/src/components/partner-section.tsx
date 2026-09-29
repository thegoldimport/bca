import { motion } from "framer-motion";
import { Check } from "lucide-react";
import glassGeoBg from "@/assets/glass-geo-bg.png";

export function PartnerSection() {
  return (
    <section className="py-24 relative overflow-hidden" id="partner">
       {/* Background - Glass Panel Theme */}
       <div className="absolute inset-0 z-0">
         <img src={glassGeoBg} alt="Background" className="w-full h-full object-cover opacity-10 rotate-180" />
         <div className="absolute inset-0 bg-gradient-to-t from-[#05050a] via-purple-900/5 to-[#05050a]" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mx-auto">
          
          {/* Left Content */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl md:text-5xl font-display font-bold text-white mb-6 drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                Want To <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">Partner?</span>
              </h2>
              <p className="text-xl text-white/60 mb-8 leading-relaxed">
                Let our team of experts build your vision for you. We'll handle development, strategy, and help you launch successfully.
              </p>
            </motion.div>

            <motion.ul 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="space-y-6 mb-10"
            >
              {[
                "Dedicated engineering team",
                "Go-to-market strategy consulting",
                "Priority 24/7 support channel",
                "Custom enterprise integrations"
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-4 text-white/80">
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 text-cyan-400" />
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </motion.ul>

            <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-white/10 backdrop-blur-md">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <img src="https://github.com/shadcn.png" alt="Founder" className="w-full h-full rounded-full opacity-80" />
                </div>
                <div>
                  <p className="text-white/90 italic mb-2">"Partnering with BuildCustom.ai accelerated our launch by 6 months. Best decision we made."</p>
                  <p className="text-sm text-white/50 font-bold uppercase tracking-wider">Alex Chen, CEO of FlowStack</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
