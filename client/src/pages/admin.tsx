import { useState, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Trash2, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";

// Mock Data
const MOCK_WAITLIST = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", date: "2026-02-12", status: "Pending" },
  { id: 2, name: "Bob Smith", email: "bob@techstart.io", date: "2026-02-12", status: "Approved" },
  { id: 3, name: "Charlie Davis", email: "charlie@design.co", date: "2026-02-11", status: "Pending" },
  { id: 4, name: "Diana Prince", email: "diana@amazon.com", date: "2026-02-11", status: "Pending" },
  { id: 5, name: "Ethan Hunt", email: "ethan@imf.org", date: "2026-02-10", status: "Approved" },
  { id: 6, name: "Fiona Gallagher", email: "fiona@chicago.net", date: "2026-02-10", status: "Rejected" },
  { id: 7, name: "George Miller", email: "george@furyroad.com", date: "2026-02-09", status: "Pending" },
];

export default function AdminDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [data, setData] = useState(MOCK_WAITLIST);
  const [, setLocation] = useLocation();

  // Protect the route
  useEffect(() => {
    const isAuthenticated = localStorage.getItem("isAuthenticated");
    if (!isAuthenticated) {
      setLocation("/login");
    }
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
      "ID,Name,Email,Date,Status\n" +
      filteredData.map((row) => `${row.id},${row.name},${row.email},${row.date},${row.status}`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "waitlist_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this entry?")) {
      setData(data.filter((item) => item.id !== id));
    }
  };

  return (
    <div className="min-h-screen bg-[#05050a] text-foreground flex flex-col">
      <Navbar />
      
      <main className="flex-1 container mx-auto px-4 py-24">
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Admin Dashboard</h1>
            <p className="text-white/60">Manage your waitlist entries.</p>
          </div>
          <div className="flex gap-4">
            <Button 
              onClick={handleExport}
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
            >
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button 
              onClick={handleLogout}
              variant="outline"
              className="border-white/10 text-white hover:bg-white/10 hover:text-white"
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
                  <TableHead className="text-white/60">Date</TableHead>
                  <TableHead className="text-white/60">Status</TableHead>
                  <TableHead className="text-white/60 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length > 0 ? (
                  filteredData.map((item) => (
                    <TableRow key={item.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="font-medium text-white/80">{item.id}</TableCell>
                      <TableCell className="text-white">{item.name}</TableCell>
                      <TableCell className="text-white/70">{item.email}</TableCell>
                      <TableCell className="text-white/60">{item.date}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium 
                          ${item.status === 'Approved' ? 'bg-green-500/20 text-green-400' : 
                            item.status === 'Rejected' ? 'bg-red-500/20 text-red-400' : 
                            'bg-yellow-500/20 text-yellow-400'}`}>
                          {item.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDelete(item.id)}
                          className="text-white/40 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-white/40">
                      No results found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="p-4 border-t border-white/10 text-xs text-white/40 text-center">
             Showing {filteredData.length} entries
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
