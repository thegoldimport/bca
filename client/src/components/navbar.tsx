import { Link } from "wouter";
import { Menu } from "lucide-react";

export function Navbar() {
  return (
    <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4">
      <nav className="w-full max-w-5xl h-16 flex items-center justify-between px-6 glass rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl">
        <Link href="/">
          <div className="text-xl font-display font-bold text-white tracking-tight cursor-pointer">
            BuildCustom.Ai
          </div>
        </Link>

        <button className="text-white/80 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full">
          <Menu size={24} />
        </button>
      </nav>
    </div>
  );
}