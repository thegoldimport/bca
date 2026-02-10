import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import heroBgV2 from "@/assets/hero-bg-v2.png";
import uiPanelLeft from "@/assets/ui-panel-left.png";
import uiPanelRight from "@/assets/ui-panel-right.png";

const CYCLING_WORDS = [
  "Websites",
  "Apps",
  "Software",
  "SaaS",
  "Anything"
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
      {/* Background Layer - Supports Video Loop */}
      <div className="absolute inset-0 z-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover opacity-100"
          poster={heroBgV2}
        >
          {/* User can upload a video named 'background-loop.mp4' to client/public/ to activate this */}
          <source src="/background-loop.mp4" type="video/mp4" />
        </video>
        {/* Deep overlay for text readability - Reduced opacity */}
        <div className="absolute inset-0 bg-background/20" />
      </div>

      {/* Floating Holographic Interface Panels - REMOVED */}
      
      <div className="relative z-10 container mx-auto px-4 flex flex-col items-center text-center mt-10">
        {/* Main Heading */}
        <h1 className="text-6xl md:text-7xl lg:text-8xl font-display font-semibold tracking-tight text-white mb-4 leading-tight drop-shadow-[0_0_25px_rgba(255,255,255,0.3)]">
          <motion.span 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="block mb-2 drop-shadow-lg"
          >
            Build Custom Ai:
          </motion.span>
          <div className="h-[1.4em] relative overflow-hidden flex justify-center items-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={index}
                initial={{ y: 70, opacity: 0, filter: "blur(20px)" }}
                animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                exit={{ y: -70, opacity: 0, filter: "blur(20px)" }}
                transition={{ duration: 0.5, ease: "circOut" }}
                className="absolute bg-gradient-to-r from-purple-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent pb-4 drop-shadow-[0_0_25px_rgba(52,211,153,0.6)] brightness-125 contrast-125"
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
          className="max-w-2xl text-lg md:text-2xl text-white/80 mb-20 font-light tracking-wide drop-shadow-lg"
        >
          Transform your wildest dreams into reality.
        </motion.p>

        {/* Input Box - Single Line Glass */}
        <motion.div 
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
          className="w-full max-w-3xl relative group px-4"
        >
          {/* Outer Glow */}
          <div className="absolute inset-4 bg-cyan-500/10 rounded-2xl blur-3xl group-hover:bg-cyan-500/20 transition-all duration-700" />
          
          {/* Glass Container with Depth */}
          <div className="relative flex flex-col md:flex-row items-center p-2
            bg-gradient-to-b from-white/10 to-white/5 
            backdrop-blur-2xl 
            border-t border-l border-r border-white/30 border-b border-white/10
            rounded-2xl
            shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5),inset_0_2px_0_0_rgba(255,255,255,0.3),inset_0_0_0_2px_rgba(255,255,255,0.05),inset_0_-4px_20px_0_rgba(0,0,0,0.2)]
            h-auto md:h-20
            transition-all hover:border-white/40 hover:bg-white/10"
          >
            {/* Top Bevel Highlight - Thicker */}
            <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-white/60 to-transparent opacity-70" />
            
            {/* Input Field */}
            <div className="flex-1 w-full h-full px-6 flex items-center relative z-10">
              <input 
                type="text" 
                placeholder="Describe your idea in as much detail as you can..." 
                className="w-full bg-transparent border-none text-white placeholder-white/40 focus:outline-none focus:ring-0 text-lg font-light h-full drop-shadow-md"
                autoFocus
                data-testid="input-hero-prompt"
              />
            </div>

            {/* Icey Glass Button with Shimmer */}
            <Button 
              className="relative z-10 w-full md:w-auto h-12 md:h-16 rounded-xl 
                bg-gradient-to-b from-cyan-200 to-cyan-400 
                hover:from-cyan-100 hover:to-cyan-300
                text-black font-display font-bold text-lg px-8 tracking-wide
                border-t border-white/80 border-b border-cyan-600/30 border-x border-white/50
                shadow-[0_0_30px_-5px_rgba(34,211,238,0.6),inset_0_2px_0_0_rgba(255,255,255,1),inset_0_-4px_2px_0_rgba(34,211,238,0.3)]
                transition-all duration-300 
                hover:scale-[1.02] hover:shadow-[0_0_50px_-5px_rgba(34,211,238,0.8),inset_0_2px_0_0_rgba(255,255,255,1)]
                m-0.5 group/btn overflow-hidden"
              data-testid="button-hero-generate"
            >
              {/* Shimmer Effect */}
              <div className="absolute inset-0 -translate-x-full group-hover/btn:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent z-20 pointer-events-none" />
              
              {/* Button Text */}
              <span className="relative z-30 drop-shadow-sm text-cyan-950">
                Generate
              </span>
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}