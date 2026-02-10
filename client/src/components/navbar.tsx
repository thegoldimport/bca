import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center px-6 glass border-b-0 border-white/5 bg-black/20 backdrop-blur-md">
      <div className="flex items-center justify-between w-full max-w-7xl mx-auto">
        <Link href="/">
          <div className="text-xl font-display font-bold text-white tracking-tight cursor-pointer flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-black font-bold text-lg">
              B
            </div>
            BuildCustom.Ai
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/70">
          <Link href="/features" className="hover:text-primary transition-colors">Features</Link>
          <Link href="/showcase" className="hover:text-primary transition-colors">Showcase</Link>
          <Link href="/pricing" className="hover:text-primary transition-colors">Pricing</Link>
          <Link href="/docs" className="hover:text-primary transition-colors">Docs</Link>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <Button variant="ghost" className="text-white hover:text-white hover:bg-white/10">
            Sign In
          </Button>
          <Button className="bg-white text-black hover:bg-white/90 font-semibold rounded-full px-6">
            Get Started
          </Button>
        </div>

        <button className="md:hidden text-white">
          <Menu size={24} />
        </button>
      </div>
    </nav>
  );
}