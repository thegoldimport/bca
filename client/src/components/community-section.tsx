import { motion } from "framer-motion";
import { Users, Bot, ArrowRight, Brain, Zap } from "lucide-react";
import iconCube from "@/assets/icon-cube.png";

export function CommunitySection() {
  return (
    <section className="py-32 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-black z-0">
         <div className="absolute inset-0 bg-gradient-to-tr from-purple-900/40 via-blue-900/20 to-black opacity-80" />
         {/* Animated orb effects */}
         <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] animate-pulse" />
         <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/20 rounded-full blur-[120px] animate-pulse delay-1000" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-20">
          
          <div className="lg:w-1/2">
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-5xl md:text-6xl font-display font-bold text-white mb-8 leading-tight"
            >
              Join the <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">Vibe Coding</span> Revolution
            </motion.h2>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl text-white/60 mb-10 leading-relaxed max-w-lg"
            >
              Stop wrestling with code. Start building with pure imagination. 
              Join thousands of creators shipping apps at the speed of thought.
            </motion.p>

            <div className="flex flex-wrap gap-8 mb-12">
              <div className="flex flex-col">
                <span className="text-4xl font-bold text-white mb-1">10k+</span>
                <span className="text-white/40 text-sm uppercase tracking-wider">Builders</span>
              </div>
              <div className="flex flex-col">
                <span className="text-4xl font-bold text-white mb-1">50k+</span>
                <span className="text-white/40 text-sm uppercase tracking-wider">Apps Deployed</span>
              </div>
              <div className="flex flex-col">
                <span className="text-4xl font-bold text-white mb-1">99%</span>
                <span className="text-white/40 text-sm uppercase tracking-wider">Satisfaction</span>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-8 py-4 bg-white text-black font-bold rounded-full flex items-center gap-2 group shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] transition-all"
            >
              Join the Community <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </motion.button>
          </div>

          <div className="lg:w-1/2 relative mt-32 mb-12 lg:mt-0 lg:mb-0">
             {/* Abstract Community Visual */}
             <div className="relative aspect-square w-full max-w-[340px] md:max-w-md mx-auto">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-purple-500/10 rounded-full blur-3xl" />
                
                {/* Users Card - Top Right */}
                <motion.div 
                  animate={{ y: [0, -20, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute top-0 -right-4 md:right-10 p-3 md:p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl md:rounded-2xl shadow-xl z-10"
                >
                  <Users className="w-6 h-6 md:w-8 md:h-8 text-cyan-400 mb-2" />
                  <div className="h-1.5 md:h-2 w-16 md:w-24 bg-white/20 rounded-full mb-2" />
                  <div className="h-1.5 md:h-2 w-10 md:w-16 bg-white/10 rounded-full" />
                </motion.div>

                {/* Robot Card - Bottom Left */}
                <motion.div 
                  animate={{ y: [0, 20, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                  className="absolute bottom-10 -left-4 md:left-0 p-3 md:p-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl md:rounded-2xl shadow-xl z-20"
                >
                  <Bot className="w-6 h-6 md:w-8 md:h-8 text-purple-400 mb-2" />
                  <div className="h-1.5 md:h-2 w-16 md:w-24 bg-white/20 rounded-full mb-2" />
                  <div className="h-1.5 md:h-2 w-10 md:w-16 bg-white/10 rounded-full" />
                </motion.div>

                {/* Brain Card - Top Left */}
                <motion.div 
                  animate={{ x: [0, 10, 0], y: [0, 10, 0] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                  className="absolute top-10 -left-2 md:left-5 p-3 md:p-5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl md:rounded-2xl shadow-xl z-10"
                >
                  <Brain className="w-5 h-5 md:w-6 md:h-6 text-pink-400 mb-2" />
                  <div className="h-1.5 w-12 md:w-16 bg-white/20 rounded-full mb-1.5" />
                  <div className="h-1.5 w-8 md:w-10 bg-white/10 rounded-full" />
                </motion.div>

                {/* Lightning Card - Bottom Right */}
                <motion.div 
                  animate={{ x: [0, -10, 0], y: [0, -10, 0] }}
                  transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
                  className="absolute bottom-20 -right-2 md:right-0 p-3 md:p-5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl md:rounded-2xl shadow-xl z-10"
                >
                  <Zap className="w-5 h-5 md:w-6 md:h-6 text-yellow-400 mb-2" />
                  <div className="h-1.5 w-12 md:w-16 bg-white/20 rounded-full mb-1.5" />
                  <div className="h-1.5 w-8 md:w-10 bg-white/10 rounded-full" />
                </motion.div>

                {/* Center Cube Logo */}
                <motion.div 
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 md:w-64 md:h-64 flex items-center justify-center z-30"
                >
                   <img src={iconCube} alt="Cube Icon" className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.3)]" />
                </motion.div>
             </div>
          </div>

        </div>
      </div>
    </section>
  );
}
