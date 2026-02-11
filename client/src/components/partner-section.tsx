import { useState } from "react";
import { motion } from "framer-motion";
import { Calendar as CalendarIcon, Clock, ArrowRight, Check } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import glassGeoBg from "@/assets/glass-geo-bg.png";

export function PartnerSection() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const timeSlots = [
    "09:00 AM", "10:00 AM", "11:00 AM",
    "01:00 PM", "02:00 PM", "03:00 PM",
    "04:00 PM", "05:00 PM"
  ];

  return (
    <section className="py-24 relative overflow-hidden" id="partner">
       {/* Background - Glass Panel Theme */}
       <div className="absolute inset-0 z-0">
         <img src={glassGeoBg} alt="Background" className="w-full h-full object-cover opacity-10 rotate-180" />
         <div className="absolute inset-0 bg-gradient-to-t from-[#05050a] via-purple-900/5 to-[#05050a]" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          {/* Left Content */}
          <div className="lg:pr-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl md:text-5xl font-display font-bold text-white mb-6 drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                Want To <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">Partner?</span>
              </h2>
              <p className="text-xl text-white/60 mb-8 leading-relaxed">
                Let our team of experts build your vision for you. We'll handle development, strategy, and help you launch successfully.
              </p>
            </motion.div>

            <motion.ul 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="space-y-6 mb-10"
            >
              {[
                "Dedicated engineering team",
                "Go-to-market strategy consulting",
                "Priority 24/7 support channel",
                "Custom enterprise integrations"
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-4 text-white/80">
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 text-cyan-400" />
                  </div>
                  <span>{item}</span>
                </li>
              ))}
            </motion.ul>

            <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-white/10 backdrop-blur-md">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <img src="https://github.com/shadcn.png" alt="Founder" className="w-full h-full rounded-full opacity-80" />
                </div>
                <div>
                  <p className="text-white/90 italic mb-2">"Partnering with BuildCustom.ai accelerated our launch by 6 months. Best decision we made."</p>
                  <p className="text-sm text-white/50 font-bold uppercase tracking-wider">Alex Chen, CEO of FlowStack</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Calendar Widget */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative"
          >
            {/* Glow Effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 rounded-3xl blur-2xl opacity-50" />

            {/* Glass Container */}
            <div className="relative rounded-3xl overflow-hidden
              bg-gradient-to-b from-[#0a0a12]/90 to-[#05050a]/90
              backdrop-blur-2xl 
              border border-white/10
              shadow-2xl
              p-6 md:p-8"
            >
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-3 text-white/80 mb-2">
                  <CalendarIcon className="w-5 h-5 text-purple-400" />
                  <span className="font-semibold tracking-wide">Select a Date & Time</span>
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                  {/* Calendar */}
                  <div className="partner-calendar">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={setDate}
                      className="rounded-md border border-white/10 bg-white/5 text-white p-3 pointer-events-auto"
                      classNames={{
                        day_selected: "bg-cyan-500 text-black hover:bg-cyan-400 focus:bg-cyan-400 font-bold",
                        day_today: "bg-white/10 text-white",
                        head_cell: "text-white/40 font-normal",
                        caption: "text-white font-medium",
                        nav_button: "hover:bg-white/10 text-white",
                        cell: "text-center text-sm p-0 relative [&:has([aria-selected])]:bg-transparent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                        day: "h-9 w-9 p-0 font-normal text-white/80 aria-selected:opacity-100 hover:bg-white/10 rounded-md transition-colors"
                      }}
                    />
                  </div>

                  {/* Time Slots */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-4 text-sm text-white/60">
                      <Clock className="w-4 h-4" />
                      <span>Available times for {date?.toLocaleDateString()}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                      {timeSlots.map((time) => (
                        <button
                          key={time}
                          onClick={() => setSelectedTime(time)}
                          className={`px-3 py-2 rounded-lg text-sm border transition-all duration-200
                            ${selectedTime === time 
                              ? "bg-cyan-500 text-black border-cyan-400 font-bold shadow-[0_0_15px_rgba(34,211,238,0.4)]" 
                              : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:border-white/20"
                            }
                          `}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <Button className="w-full h-12 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold rounded-xl mt-4 shadow-[0_0_20px_rgba(168,85,247,0.3)] border border-white/10">
                  Book Strategy Call <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
