import { motion } from "framer-motion";
import showcaseDashboard from "@/assets/showcase-dashboard.png";
import showcaseMobile from "@/assets/showcase-mobile.png";
import showcaseSaas from "@/assets/showcase-saas.png";

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
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-24">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-display font-bold text-white mb-6"
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

        <div className="space-y-32">
          {SHOWCASES.map((showcase, index) => (
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

              <div className="flex-1 w-full">
                <div className="relative group">
                  {/* Glow Effect */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-2xl blur-2xl opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
                  
                  {/* Thick Glass Container */}
                  <div className="relative rounded-2xl overflow-hidden
                    bg-gradient-to-b from-white/10 to-white/5 
                    backdrop-blur-2xl 
                    border border-white/20
                    shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5),inset_0_2px_0_0_rgba(255,255,255,0.2),inset_0_0_0_2px_rgba(255,255,255,0.05)]"
                  >
                    <img 
                      src={showcase.image} 
                      alt={showcase.title} 
                      className="w-full h-auto object-cover opacity-90 group-hover:scale-105 transition-transform duration-700"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
