import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import heroBgV2 from "@/assets/hero-bg-v2.png";
import uiPanelLeft from "@/assets/ui-panel-left.png";
import uiPanelRight from "@/assets/ui-panel-right.png";

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
          src={heroBgV2} 
          alt="" 
          className="w-full h-full object-cover"
        />
        {/* Deep overlay for text readability */}
        <div className="absolute inset-0 bg-background/50" />
      </div>

      {/* Floating Holographic Interface Panels */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden perspective-[2000px]">
        {/* Left Panel - Analytics Hologram */}
        <motion.div 
          initial={{ x: -100, opacity: 0, rotateY: 20 }}
          animate={{ x: 0, opacity: 0.8, rotateY: 15 }}
          transition={{ duration: 1.5, delay: 0.2 }}
          className="absolute top-[25%] left-[-5%] md:left-[5%] w-[400px] md:w-[500px] h-[300px] opacity-80 mix-blend-screen hidden md:block"
          style={{ transform: "rotateY(15deg)" }}
        >
          <img src={uiPanelLeft} alt="" className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(34,211,238,0.3)]" />
        </motion.div>

        {/* Right Panel - Code Hologram */}
        <motion.div 
          initial={{ x: 100, opacity: 0, rotateY: -20 }}
          animate={{ x: 0, opacity: 0.8, rotateY: -15 }}
          transition={{ duration: 1.5, delay: 0.4 }}
          className="absolute top-[20%] right-[-5%] md:right-[5%] w-[400px] md:w-[550px] h-[350px] opacity-80 mix-blend-screen hidden md:block"
          style={{ transform: "rotateY(-15deg)" }}
        >
          <img src={uiPanelRight} alt="" className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(168,85,247,0.3)]" />
        </motion.div>
      </div>

      <div className="relative z-10 container mx-auto px-4 flex flex-col items-center text-center mt-10">
        {/* Main Heading */}
        <h1 className="text-6xl md:text-7xl lg:text-8xl font-display font-bold tracking-tight text-white mb-4 leading-tight drop-shadow-2xl">
          <motion.span 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="block mb-2"
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
                className="absolute bg-gradient-to-b from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent pb-4"
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
          Transform concepts into code with intelligent automation.
        </motion.p>

        {/* Input Box - Tall, Rounded, Glassy */}
        <motion.div 
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
          className="w-full max-w-4xl relative group px-4"
        >
          {/* Outer Glow */}
          <div className="absolute inset-4 bg-cyan-500/20 rounded-[2.5rem] blur-3xl group-hover:bg-cyan-500/30 transition-all duration-700" />
          
          {/* Glass Container */}
          <div className="relative flex flex-col md:flex-row items-center p-2 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] h-auto md:h-28 transition-all hover:border-white/20 hover:bg-white/10">
            
            {/* Input Field */}
            <div className="flex-1 w-full h-full px-8 flex items-center">
              <input 
                type="text" 
                placeholder="[Describe your AI project...]" 
                className="w-full bg-transparent border-none text-white placeholder-white/30 focus:outline-none focus:ring-0 text-xl md:text-2xl font-light h-full"
                autoFocus
                data-testid="input-hero-prompt"
              />
            </div>

            {/* Generate Button */}
            <Button 
              className="w-full md:w-auto h-20 md:h-24 rounded-[2rem] bg-gradient-to-r from-cyan-400 to-cyan-300 hover:from-white hover:to-cyan-200 text-black font-bold text-xl px-12 shadow-[0_0_40px_rgba(34,211,238,0.4)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_60px_rgba(34,211,238,0.6)] m-1"
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