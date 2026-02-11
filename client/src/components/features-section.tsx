import { motion } from "framer-motion";
import { 
  MessageSquare, 
  Database, 
  Rocket, 
  Code2, 
  Smartphone,
  Zap
} from "lucide-react";

const FEATURES = [
  {
    title: "100% Chat-Native",
    description: "Build full-stack apps just by chatting. No drag-and-drop, no complexity. Just describe it.",
    icon: MessageSquare,
    color: "from-blue-400 to-cyan-300"
  },
  {
    title: "Database Included",
    description: "Backend? Already done. We automatically provision and manage your database schema.",
    icon: Database,
    color: "from-purple-400 to-pink-300"
  },
  {
    title: "One-Click Deploy",
    description: "Go from idea to live URL in seconds. We handle the infrastructure, SSL, and scaling.",
    icon: Rocket,
    color: "from-emerald-400 to-green-300"
  },
  {
    title: "Full Code Access",
    description: "Not locked in. Eject anytime. Edit the generated code directly in our VS Code-like editor.",
    icon: Code2,
    color: "from-orange-400 to-red-300"
  },
  {
    title: "Mobile Ready",
    description: "Every app you build is responsive and mobile-optimized by default. Works on any device.",
    icon: Smartphone,
    color: "from-indigo-400 to-violet-300"
  },
  {
    title: "Instant Iteration",
    description: "Make changes in real-time. 'Make the button blue', 'Add a user profile', done instantly.",
    icon: Zap,
    color: "from-yellow-400 to-amber-300"
  }
];

export function FeaturesSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-5xl font-display font-bold text-white mb-6"
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
              {/* Card Background with Glassmorphism */}
              <div className="absolute inset-0 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 transition-all duration-300 group-hover:bg-white/10 group-hover:border-white/20" />
              
              {/* Hover Gradient Glow */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity duration-500`} />

              <div className="relative p-8 flex flex-col h-full">
                <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${feature.color} p-0.5 mb-6 inline-flex items-center justify-center`}>
                  <div className="w-full h-full bg-black/50 backdrop-blur-sm rounded-[7px] flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                </div>

                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-white/60 leading-relaxed">
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
