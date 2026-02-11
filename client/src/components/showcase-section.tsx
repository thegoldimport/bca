import { motion } from "framer-motion";
import showcaseDashboard from "@/assets/showcase-dashboard.png";
import showcaseMobile from "@/assets/showcase-mobile.png";
import showcaseSaas from "@/assets/showcase-saas.png";
import neonGeoBg from "@/assets/neon-geo-bg.png";

const SHOWCASES = [
  {
    title: "Enterprise Analytics",
    description: "Build complex dashboards with real-time data visualization in minutes. Connect to any database and visualize your metrics.",
    image: showcaseDashboard,
    alignment: "right"
  },
  {
    title: "Consumer Mobile Apps",
    description: "Create stunning, native-feeling mobile experiences. Animations, gestures, and touch interactions come standard.",
    image: showcaseMobile,
    alignment: "left"
  },
  {
    title: "SaaS Platforms",
    description: "From Kanban boards to CRM systems, build sophisticated tools for your business logic without writing boilerplate.",
    image: showcaseSaas,
    alignment: "right"
  }
];

export function ShowcaseSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background Image Overlay */}
      <div className="absolute inset-0 z-0 opacity-40">
        <img src={neonGeoBg} alt="Background" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05050a] via-transparent to-[#05050a]" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-24">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-cyan-300 mb-6 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]"
          >
            Dream big. Build fast.
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-white/60 max-w-2xl mx-auto"
          >
            From simple landing pages to complex SaaS applications, if you can describe it, you can build it.
          </motion.p>
        </div>

        <div className="space-y-24">
          {SHOWCASES.map((showcase, index) => {
            const isMobile = showcase.title === "Consumer Mobile Apps";
            return (
              <motion.div 
                key={showcase.title}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8 }}
                className={`flex flex-col ${showcase.alignment === "left" ? "lg:flex-row-reverse" : "lg:flex-row"} items-center gap-12 lg:gap-20`}
              >
                <div className="flex-1 space-y-6">
                  <h3 className="text-3xl md:text-4xl font-bold text-white leading-tight">
                    {showcase.title}
                  </h3>
                  <p className="text-lg text-white/60 leading-relaxed">
                    {showcase.description}
                  </p>
                  <div className="flex items-center gap-4 text-cyan-400 font-medium group cursor-pointer">
                    <span>Start building</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </div>

                <div className="flex-1 w-full flex justify-center">
                  <div className={`relative group w-full ${isMobile ? 'max-w-[240px]' : 'max-w-md'}`}>
                    {/* Glow Effect - Removed for mobile if desired, but kept for "vibe". Let's remove bg box for mobile specifically */}
                    {/* Only show glow box if NOT mobile */}
                    {!isMobile && (
                      <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-2xl blur-2xl opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
                    )}
                    
                    {/* Container - Conditional Styling */}
                    <div className={`relative rounded-2xl overflow-hidden
                      ${isMobile 
                        ? '' // No glass container for mobile
                        : 'bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-2xl border border-white/20 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5),inset_0_2px_0_0_rgba(255,255,255,0.2),inset_0_0_0_2px_rgba(255,255,255,0.05)]'
                      }
                    `}>
                      <img 
                        src={showcase.image} 
                        alt={showcase.title} 
                        className={`w-full h-auto object-cover opacity-90 group-hover:scale-105 transition-transform duration-700 ${isMobile ? 'rounded-[2.5rem]' : ''}`}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
