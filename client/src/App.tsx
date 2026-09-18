import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/home";
import AdminDashboard from "@/pages/admin";
import Login from "@/pages/login";
import AppDashboard from "@/pages/app-dashboard";
import AppAuth from "@/pages/app-auth";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/login" component={Login} />
      <Route path="/app/login" component={AppAuth} />
      <Route path="/app/signup" component={AppAuth} />
      <Route path="/app" component={AppDashboard} />
      <Route path="/app/project/:id" component={AppDashboard} />
      <Route path="/app/editor/:id" component={AppDashboard} />
      <Route path="/app/:rest*" component={AppDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Router />
    </QueryClientProvider>
  );
}

export default App;