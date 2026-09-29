import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/home";
import AppDashboard from "@/pages/app-dashboard";
import AppAuth from "@/pages/app-auth";
import ResetPassword from "@/pages/reset-password";
import NotFound from "@/pages/not-found";
import AppEntry from "@/pages/app-entry";
import { useEffect } from "react";
import { useLocation } from "wouter";

function LegacyAuthRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(`${to}${window.location.search}`, { replace: true });
  }, [navigate, to]);
  return null;
}

function Router() {
  const appHost = window.location.hostname.toLowerCase() === "app.buildcustom.ai";
  return (
    <Switch>
      <Route path="/" component={appHost ? AppEntry : Home} />
      {appHost && <Route path="/login" component={AppAuth} />}
      {appHost && <Route path="/signup" component={AppAuth} />}
      {appHost && <Route path="/forgot-password" component={AppAuth} />}
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/app/login">{() => <LegacyAuthRedirect to="/login" />}</Route>
      <Route path="/app/signup">{() => <LegacyAuthRedirect to="/signup" />}</Route>
      <Route path="/app/forgot-password">{() => <LegacyAuthRedirect to="/forgot-password" />}</Route>
      <Route path="/app/reset-password">{() => <LegacyAuthRedirect to="/reset-password" />}</Route>
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