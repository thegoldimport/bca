import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import heroBgShapes from "@/assets/hero-bg-shapes.png";

const CYCLING_WORDS = [
  "websites",
  "apps",
  "software",
  "SaaS",
  "anything"
];

export function Hero() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % CYCLING_WORDS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center overflow-hidden pt-24 pb-12">
      {/* Background Image Layer */}
      <div className="absolute inset-0 z-0">
        <img 
          src={heroBgShapes} 
          alt="" 
          className="w-full h-full object-cover opacity-80"
        />
        {/* Overlay gradient to ensure text readability and match the deep void look */}
        <div className="absolute inset-0 bg-background/60 bg-[radial-gradient(circle_at_center,transparent_0%,var(--background)_90%)]" />
      </div>

      {/* Floating Glass Panels (Simulated Dashboards) */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden perspective-[2000px]">
        {/* Left Panel - Code/Analytics */}
        <motion.div 
          initial={{ x: -100, opacity: 0, rotateY: 20 }}
          animate={{ x: 0, opacity: 1, rotateY: 15 }}
          transition={{ duration: 1, delay: 0.5 }}
          className="absolute top-1/3 left-[5%] lg:left-[10%] w-[300px] h-[200px] glass-panel rounded-xl p-4 transform-gpu hidden md:block border-l-2 border-l-primary/30"
          style={{ transform: "rotateY(15deg) rotateX(5deg)" }}
        >
          <div className="flex gap-2 mb-3">
             <div className="w-3 h-3 rounded-full bg-red-500/50" />
             <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
             <div className="w-3 h-3 rounded-full bg-green-500/50" />
          </div>
          <div className="space-y-2 opacity-60">
             <div className="h-2 w-3/4 bg-white/20 rounded" />
             <div className="h-2 w-1/2 bg-white/20 rounded" />
             <div className="h-2 w-full bg-white/20 rounded" />
             <div className="mt-4 flex gap-2 items-end h-20">
                <div className="w-1/4 bg-primary/40 h-full rounded-t" />
                <div className="w-1/4 bg-primary/20 h-1/2 rounded-t" />
                <div className="w-1/4 bg-primary/60 h-3/4 rounded-t" />
                <div className="w-1/4 bg-accent/40 h-2/3 rounded-t" />
             </div>
          </div>
        </motion.div>

        {/* Right Panel - Data/Graph */}
        <motion.div 
          initial={{ x: 100, opacity: 0, rotateY: -20 }}
          animate={{ x: 0, opacity: 1, rotateY: -15 }}
          transition={{ duration: 1, delay: 0.7 }}
          className="absolute top-1/4 right-[5%] lg:right-[10%] w-[340px] h-[240px] glass-panel rounded-xl p-4 transform-gpu hidden md:block border-r-2 border-r-accent/30"
          style={{ transform: "rotateY(-15deg) rotateX(5deg)" }}
        >
           <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
             <div className="h-3 w-20 bg-white/30 rounded" />
             <div className="h-3 w-8 bg-emerald-500/50 rounded" />
           </div>
           <div className="grid grid-cols-2 gap-3">
              <div className="h-24 bg-white/5 rounded border border-white/5 p-2">
                 <div className="h-full w-full bg-gradient-to-t from-emerald-500/20 to-transparent rounded" />
              </div>
              <div className="space-y-2">
                 <div className="h-8 bg-white/5 rounded" />
                 <div className="h-8 bg-white/5 rounded" />
                 <div className="h-8 bg-white/5 rounded" />
              </div>
           </div>
        </motion.div>

         {/* Top Center Panel (Small) */}
        <motion.div 
          initial={{ y: -50, opacity: 0, rotateX: 20 }}
          animate={{ y: 0, opacity: 0.8, rotateX: 10 }}
          transition={{ duration: 1, delay: 0.9 }}
          className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[400px] h-[100px] glass-panel rounded-xl p-4 transform-gpu hidden lg:block border-t border-white/20"
          style={{ transform: "rotateX(10deg)" }}
        >
           <div className="flex gap-4 items-center h-full justify-center opacity-70">
              <div className="text-xs font-mono text-cyan-400">STATUS: ACTIVE</div>
              <div className="h-1 w-20 bg-white/10 rounded overflow-hidden">
                 <div className="h-full w-2/3 bg-cyan-400" />
              </div>
              <div className="text-xs font-mono text-purple-400">98.4% UPTIME</div>
           </div>
        </motion.div>
      </div>

      <div className="relative z-10 container mx-auto px-4 flex flex-col items-center text-center mt-10">
        {/* Main Heading */}
        <h1 className="text-6xl md:text-7xl lg:text-8xl font-display font-bold tracking-tight text-white mb-2 leading-tight">
          <motion.span 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="block"
          >
            Build Custom Ai:
          </motion.span>
          <div className="h-[1.4em] relative overflow-hidden flex justify-center items-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={index}
                initial={{ y: 60, opacity: 0, filter: "blur(12px)" }}
                animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                exit={{ y: -60, opacity: 0, filter: "blur(12px)" }}
                transition={{ duration: 0.6, ease: "circOut" }}
                className="absolute bg-gradient-to-b from-white via-cyan-200 to-cyan-400 bg-clip-text text-transparent pb-4"
              >
                {CYCLING_WORDS[index]}
              </motion.span>
            </AnimatePresence>
          </div>
        </h1>

        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-2xl text-lg md:text-xl text-white/70 mb-16 font-light tracking-wide"
        >
          Transform concepts into code with intelligent automation.
        </motion.p>

        {/* Updated Input Box - Taller, Rounded Glass */}
        <motion.div 
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
          className="w-full max-w-4xl relative group px-4"
        >
          {/* Enhanced Glow behind input */}
          <div className="absolute inset-4 bg-gradient-to-r from-primary via-white to-accent rounded-[2rem] opacity-10 blur-2xl group-hover:opacity-20 transition-opacity duration-700" />
          
          <div className="relative flex flex-col md:flex-row items-center gap-2 p-3 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)] h-auto md:h-24 transition-all hover:bg-white/10 hover:border-white/20">
            <div className="flex-1 flex items-center gap-4 px-6 w-full h-full">
              <input 
                type="text" 
                placeholder="[Describe your AI project (e.g., predictive maintenance SaaS)...]" 
                className="w-full bg-transparent border-none text-white placeholder-white/30 focus:outline-none focus:ring-0 text-xl font-light h-full py-4"
                autoFocus
                data-testid="input-hero-prompt"
              />
            </div>
            <Button 
              size="lg" 
              className="w-full md:w-auto rounded-full bg-gradient-to-r from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 text-black font-bold px-10 h-16 text-lg shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all duration-300 transform hover:scale-105"
              data-testid="button-hero-generate"
            >
              Generate
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}