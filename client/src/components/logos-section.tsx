import { motion } from "framer-motion";

const LOGOS = [
  {
    name: "Anthropic",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/78/Anthropic_logo.svg",
    className: "h-8 md:h-10 opacity-90 hover:opacity-100 transition-opacity invert"
  },
  {
    name: "Google",
    url: "https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_2015_logo.svg",
    className: "h-8 md:h-10 opacity-90 hover:opacity-100 transition-opacity"
  },
  {
    name: "OpenAI",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg", 
    className: "h-8 md:h-10 opacity-90 hover:opacity-100 transition-opacity invert"
  },
  {
    name: "Cloudflare",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/4b/Cloudflare_Logo.svg",
    // Invert(1) makes black text white and orange cloud blue. Hue-rotate(180deg) turns blue back to orange.
    className: "h-8 md:h-10 opacity-90 hover:opacity-100 transition-opacity invert hue-rotate-180" 
  }
];

export function LogosSection() {
  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background Gradient - Subtle */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-900/10 to-transparent pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-12">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-lg md:text-xl font-light tracking-widest text-white/50 uppercase"
          >
            Built On The Shoulders Of Giants
          </motion.h2>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-80">
          {LOGOS.map((logo, index) => (
            <motion.div
              key={logo.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative"
            >
              <div className="absolute -inset-4 bg-white/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <img 
                src={logo.url} 
                alt={`${logo.name} Logo`} 
                className={`${logo.className} relative z-10`}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
