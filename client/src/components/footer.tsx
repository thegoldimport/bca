import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative bg-black border-t border-white/10 pt-24 pb-12 overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start mb-16">
          <div className="mb-10 md:mb-0 max-w-sm">
            <h3 className="text-2xl font-display font-bold text-white mb-4">BuildCustom.ai</h3>
            <p className="text-white/50 mb-6">
              The futuristic vibe coding platform that turns your ideas into reality. 
              Built on the shoulders of giants.
            </p>
            <div className="flex gap-4">
              <Button variant="outline" size="sm" className="rounded-full border-white/20 text-white hover:bg-white/10">
                Twitter
              </Button>
              <Button variant="outline" size="sm" className="rounded-full border-white/20 text-white hover:bg-white/10">
                GitHub
              </Button>
              <Button variant="outline" size="sm" className="rounded-full border-white/20 text-white hover:bg-white/10">
                Discord
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-12 md:gap-24">
            <div>
              <h4 className="text-white font-semibold mb-6">Product</h4>
              <ul className="space-y-4 text-white/50">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Changelog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Docs</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-6">Company</h4>
              <ul className="space-y-4 text-white/50">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-1">
              <h4 className="text-white font-semibold mb-6">Legal</h4>
              <ul className="space-y-4 text-white/50">
                <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center text-white/30 text-sm">
          <p>© {currentYear} BuildCustom.ai. All rights reserved.</p>
          <div className="flex items-center gap-2 mt-4 md:mt-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>All Systems Operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
