import neonGeoBg from "@/assets/neon-geo-bg.png";

// ... features data ...

export function FeaturesSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background Overlay - Dark Neon Theme */}
      <div className="absolute inset-0 z-0">
        <img src={neonGeoBg} alt="Background" className="w-full h-full object-cover opacity-30 mix-blend-screen" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05050a] via-purple-900/10 to-[#05050a]" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-display font-bold text-white mb-6 drop-shadow-[0_0_20px_rgba(168,85,247,0.5)]"
          >
            Power under the hood.
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xl text-white/60 max-w-2xl mx-auto"
          >
            The first AI-powered app builder that runs entirely through natural language.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative h-full"
            >
              {/* Card Background with Thick Glassmorphism and Neon Borders */}
              <div className="absolute inset-0 rounded-2xl transition-all duration-300
                bg-gradient-to-b from-white/10 to-white/5 
                backdrop-blur-2xl 
                border-t border-l border-r border-white/20 border-b border-white/10
                shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5),inset_0_2px_0_0_rgba(255,255,255,0.2),inset_0_0_0_2px_rgba(255,255,255,0.05)]
                group-hover:shadow-[0_0_30px_-5px_rgba(255,255,255,0.1)]
                "
              />
              
              {/* Hover Gradient Glow - Stronger */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity duration-500 blur-xl`} />

              <div className="relative p-8 flex flex-col h-full z-10">
                <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${feature.color} p-0.5 mb-6 inline-flex items-center justify-center shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)]`}>
                  <div className="w-full h-full bg-black/40 backdrop-blur-md rounded-[7px] flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                </div>

                <h3 className="text-xl font-bold text-white mb-3 drop-shadow-sm">{feature.title}</h3>
                <p className="text-white/70 leading-relaxed font-light">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
