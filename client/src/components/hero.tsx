import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, Terminal, Code2, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="relative min-h-screen flex flex-col justify-center items-center overflow-hidden pt-20">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        {/* Deep background gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-background to-background" />
        
        {/* Animated Grid */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
        
        {/* Floating Shapes - Replicating the vibe of the attached image */}
        <div className="absolute top-1/4 left-10 w-64 h-64 bg-primary/20 rounded-full blur-[100px] animate-pulse-glow" />
        <div className="absolute bottom-1/4 right-10 w-96 h-96 bg-accent/20 rounded-full blur-[120px] animate-pulse-glow delay-1000" />
        
        {/* Geometric Glass Elements (Decorations) */}
        <FloatingElement className="absolute top-32 left-[10%] hidden lg:block" delay={0}>
          <div className="w-16 h-16 border border-white/10 bg-white/5 backdrop-blur-sm rounded-xl transform rotate-12 flex items-center justify-center">
            <Terminal className="text-primary w-8 h-8" />
          </div>
        </FloatingElement>
        
        <FloatingElement className="absolute top-40 right-[15%] hidden lg:block" delay={1}>
          <div className="w-20 h-20 border border-white/10 bg-white/5 backdrop-blur-sm rounded-2xl transform -rotate-6 flex items-center justify-center">
            <Code2 className="text-accent w-10 h-10" />
          </div>
        </FloatingElement>

        <FloatingElement className="absolute bottom-40 left-[15%] hidden lg:block" delay={2}>
           <div className="w-12 h-12 border border-white/10 bg-white/5 backdrop-blur-sm rounded-lg transform rotate-45 flex items-center justify-center">
             <Cpu className="text-emerald-400 w-6 h-6" />
           </div>
        </FloatingElement>
      </div>

      <div className="relative z-10 container mx-auto px-4 flex flex-col items-center text-center">
        {/* Pill Badge */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-sm text-white/70 hover:bg-white/10 transition-colors cursor-pointer group"
        >
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>v2.0 is now live</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </motion.div>

        {/* Main Heading */}
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-display font-bold tracking-tight text-white mb-6">
          <motion.span 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="block mb-2"
          >
            Build Custom Ai:
          </motion.span>
          <div className="h-[1.2em] relative overflow-hidden flex justify-center items-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={index}
                initial={{ y: 50, opacity: 0, filter: "blur(10px)" }}
                animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                exit={{ y: -50, opacity: 0, filter: "blur(10px)" }}
                transition={{ duration: 0.5, ease: "circOut" }}
                className="absolute bg-gradient-to-r from-primary via-white to-accent bg-clip-text text-transparent pb-4"
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
          className="max-w-2xl text-lg md:text-xl text-white/60 mb-12"
        >
          Transform concepts into code with intelligent automation.
          <br className="hidden md:block" />
          The most advanced AI engineering platform for modern builders.
        </motion.p>

        {/* Input Box Area */}
        <motion.div 
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
          className="w-full max-w-3xl relative group"
        >
          <div className="absolute -inset-1 bg-gradient-to-r from-primary via-accent to-primary rounded-2xl opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-500" />
          
          <div className="relative flex flex-col md:flex-row items-center gap-2 p-2 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
            <div className="flex-1 flex items-center gap-3 px-4 w-full">
              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              <input 
                type="text" 
                placeholder="Describe your AI project (e.g., predictive maintenance SaaS)..." 
                className="w-full bg-transparent border-none text-white placeholder-white/40 focus:outline-none focus:ring-0 text-lg py-4"
                autoFocus
                data-testid="input-hero-prompt"
              />
            </div>
            <Button 
              size="lg" 
              className="w-full md:w-auto rounded-xl bg-white text-black hover:bg-white/90 font-bold px-8 h-14 text-base shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] transition-all duration-300"
              data-testid="button-hero-generate"
            >
              Generate
            </Button>
          </div>
          
          <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm text-white/40">
            <span>Try:</span>
            <button className="hover:text-primary transition-colors">CRM Dashboard</button>
            <span>•</span>
            <button className="hover:text-primary transition-colors">E-commerce API</button>
            <span>•</span>
            <button className="hover:text-primary transition-colors">Chat Application</button>
          </div>
        </motion.div>
      </div>
      
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
    </div>
  );
}

function FloatingElement({ children, className, delay = 0 }: { children: React.ReactNode, className?: string, delay?: number }) {
  return (
    <motion.div
      className={className}
      animate={{ 
        y: [0, -15, 0],
        rotate: [0, 5, 0]
      }}
      transition={{ 
        duration: 6,
        repeat: Infinity,
        ease: "easeInOut",
        delay: delay
      }}
    >
      {children}
    </motion.div>
  );
}