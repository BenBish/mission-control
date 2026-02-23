import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, Moon, Sun, LayoutDashboard, Settings, Users, List, DollarSign, Zap, Bot, Wrench, Clock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTheme } from "@/app/providers";


const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/activities", icon: List, label: "Activities" },
  { to: "/agents", icon: Bot, label: "Agents" },
  { to: "/costs", icon: DollarSign, label: "Cost Breakdown" },
  { to: "/skills", icon: Wrench, label: "Skills" },
  { to: "/permissions", icon: Shield, label: "Permissions" },
  { to: "/cron", icon: Clock, label: "Cron Jobs" },
  { to: "/users", icon: Users, label: "Users" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  
  return (
    <div className="flex h-full flex-col">
      {/* Logo / Header */}
      <div className="flex h-16 items-center gap-3 border-b px-5 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-sm tracking-tight">Mission Control</span>
          <span className="text-xs text-muted-foreground">Orca Dashboard</span>
        </div>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 group ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <div className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                isActive 
                  ? "bg-primary-foreground/20" 
                  : "bg-muted group-hover:bg-background"
              }`}>
                <item.icon className="h-4 w-4" />
              </div>
              {item.label}
              {isActive && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-foreground" />
              )}
            </NavLink>
          );
        })}
      </nav>
      
      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-muted-foreground">System Online</span>
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9 rounded-lg">
      {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export function MainLayout() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 border-r bg-card lg:block">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <Sidebar onNavigate={() => setIsMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-16 items-center gap-4 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 px-4 lg:px-6 sticky top-0 z-30">
          <Sheet>
            <SheetTrigger asChild className="lg:hidden">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>
          
          <div className="flex-1" />
          
          <ThemeToggle />
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
