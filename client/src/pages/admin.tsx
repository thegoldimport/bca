import { useState, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Trash2, LogOut, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import type { WaitlistEntry } from "@shared/schema";

export default function AdminDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [data, setData] = useState<WaitlistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  const fetchEntries = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/waitlist");
      if (res.ok) {
        const entries = await res.json();
        setData(entries);
      }
    } catch (err) {
      console.error("Failed to fetch waitlist:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const isAuthenticated = localStorage.getItem("isAuthenticated");
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    fetchEntries();
  }, [setLocation]);

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated");
    setLocation("/login");
  };

  const filteredData = data.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExport = () => {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      "ID,Name,Email,Source,Status,Date\n" +
      filteredData.map((row) => `${row.id},"${row.name}","${row.email}","${row.source}","${row.status}","${new Date(row.createdAt).toLocaleDateString()}"`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "waitlist_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this entry?")) {
      try {
        const res = await fetch(`/api/admin/waitlist/${id}`, { method: "DELETE" });
        if (res.ok) {
          setData(data.filter((item) => item.id !== id));
        }
      } catch (err) {
        console.error("Failed to delete entry:", err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#05050a] text-foreground flex flex-col">
      <Navbar />
      
      <main className="flex-1 container mx-auto px-4 py-24">
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2" data-testid="text-admin-title">Admin Dashboard</h1>
            <p className="text-white/60">Manage your waitlist entries. <span className="text-cyan-400 font-medium">{data.length} total signups</span></p>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={fetchEntries}
              variant="outline"
              className="border-white/10 text-white hover:bg-white/10 hover:text-white"
              data-testid="button-refresh"
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button 
              onClick={handleExport}
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
              data-testid="button-export"
            >
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button 
              onClick={handleLogout}
              variant="outline"
              className="border-white/10 text-white hover:bg-white/10 hover:text-white"
              data-testid="button-logout"
            >
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </Button>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden backdrop-blur-sm">
          <div className="p-4 border-b border-white/10">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-black/20 border-white/10 text-white placeholder:text-white/30 focus:ring-cyan-500/50"
                data-testid="input-search"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-white/5">
                  <TableHead className="text-white/60">ID</TableHead>
                  <TableHead className="text-white/60">Name</TableHead>
                  <TableHead className="text-white/60">Email</TableHead>
                  <TableHead className="text-white/60">Source</TableHead>
                  <TableHead className="text-white/60">Status</TableHead>
                  <TableHead className="text-white/60">Date</TableHead>
                  <TableHead className="text-white/60 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-white/40">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredData.length > 0 ? (
                  filteredData.map((item) => (
                    <TableRow key={item.id} className="border-white/10 hover:bg-white/5" data-testid={`row-entry-${item.id}`}>
                      <TableCell className="font-medium text-white/80">{item.id}</TableCell>
                      <TableCell className="text-white">{item.name}</TableCell>
                      <TableCell className="text-white/70">{item.email}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium 
                          ${item.source === 'strategy_call' ? 'bg-purple-500/20 text-purple-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                          {item.source === 'strategy_call' ? 'Strategy Call' : 'Waitlist'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium 
                          ${item.status === 'Approved' ? 'bg-green-500/20 text-green-400' : 
                            item.status === 'Rejected' ? 'bg-red-500/20 text-red-400' : 
                            'bg-yellow-500/20 text-yellow-400'}`}>
                          {item.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-white/60">{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDelete(item.id)}
                          className="text-white/40 hover:text-red-400 hover:bg-red-500/10"
                          data-testid={`button-delete-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-white/40">
                      No results found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="p-4 border-t border-white/10 text-xs text-white/40 text-center">
             Showing {filteredData.length} of {data.length} entries
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
