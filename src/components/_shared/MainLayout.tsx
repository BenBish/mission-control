import { useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Menu,
  Moon,
  Sun,
  LayoutDashboard,
  Settings,
  List,
  DollarSign,
  Zap,
  Clock,
  History,
  LogOut,
  AlertTriangle,
  Server,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTheme } from "@/app/providers";
import { useAuth } from "@/app/auth/AuthContext";
import { SourceFilter } from "@/components/_shared/SourceFilter";
import { useSources } from "@/lib/queries";
import { useNow } from "@/hooks/useNow";
import {
  getSystemHealth,
  SYSTEM_STATUS_DOT_CLASS,
  SYSTEM_STATUS_LABEL,
} from "@/services/sourceHealth";
import {
  getWorkloadAvailability,
  shouldShowWorkloadInNav,
  type WorkloadId,
} from "@/lib/workload-availability";
import { cn } from "@/lib/utils";

type NavIcon = ComponentType<{ className?: string }>;

interface PrimaryNavItem {
  kind: "link";
  to: string;
  icon: NavIcon;
  label: string;
}

interface WorkloadNavItem {
  to: string;
  icon: NavIcon;
  label: string;
  workloadId: WorkloadId;
}

const primaryNavItems: PrimaryNavItem[] = [
  { kind: "link", to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { kind: "link", to: "/activities", icon: List, label: "Activities" },
  { kind: "link", to: "/sessions", icon: History, label: "Sessions" },
  { kind: "link", to: "/runtime", icon: Server, label: "Runtime" },
  { kind: "link", to: "/failures", icon: AlertTriangle, label: "Failures" },
  { kind: "link", to: "/consumption", icon: DollarSign, label: "Consumption" },
];

const workloadNavItems: WorkloadNavItem[] = [
  { to: "/jobs", icon: Clock, label: "Jobs", workloadId: "jobs" },
  {
    to: "/generations",
    icon: ImageIcon,
    label: "Generations",
    workloadId: "generations",
  },
];

const settingsNavItem: PrimaryNavItem = {
  kind: "link",
  to: "/settings",
  icon: Settings,
  label: "Settings",
};

function SystemStatusFooter() {
  const { data: sources, isLoading, isError } = useSources();
  // Recompute age-based health even when source payloads are unchanged.
  const now = useNow();

  const instances = (sources ?? []).flatMap((s) => s.instances);
  const systemStatus = isError
    ? ("Error" as const)
    : isLoading && !sources
      ? ("Unknown" as const)
      : getSystemHealth(instances, now);

  const label = isError ? "API Unreachable" : SYSTEM_STATUS_LABEL[systemStatus];

  return (
    <div className="border-t p-4">
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
        <div
          className={`h-2 w-2 rounded-full ${SYSTEM_STATUS_DOT_CLASS[systemStatus]}`}
        />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function NavItemLink({
  to,
  icon: Icon,
  label,
  onNavigate,
  deemphasized,
  badge,
}: {
  to: string;
  icon: NavIcon;
  label: string;
  onNavigate?: () => void;
  deemphasized?: boolean;
  badge?: string;
}) {
  const location = useLocation();
  const isActive =
    location.pathname === to ||
    (to !== "/" && location.pathname.startsWith(to));

  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      title={
        deemphasized && badge
          ? `${label} (${badge}) — still available via direct URL`
          : undefined
      }
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 group",
        isActive
          ? "bg-primary text-primary-foreground shadow-sm"
          : deemphasized
            ? "text-muted-foreground/60 hover:bg-accent/50 hover:text-muted-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          isActive
            ? "bg-primary-foreground/20"
            : deemphasized
              ? "bg-muted/50 group-hover:bg-muted"
              : "bg-muted group-hover:bg-background",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <span className={cn(deemphasized && !isActive && "opacity-80")}>
        {label}
      </span>
      {badge && !isActive && (
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70 font-normal">
          {badge}
        </span>
      )}
      {isActive && (
        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-foreground" />
      )}
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const {
    data: sources,
    isLoading: sourcesLoading,
    isError: sourcesError,
  } = useSources();
  // While sources load or the registry request fails, pass undefined so
  // workloads stay primary — never hide the section on a transient API outage.
  const sourcesForAvailability =
    (sourcesLoading && !sources) || sourcesError ? undefined : sources;

  const visibleWorkloads = workloadNavItems
    .map((item) => {
      const availability = getWorkloadAvailability(
        item.workloadId,
        sourcesForAvailability,
      );
      return { item, availability };
    })
    .filter(({ availability }) => shouldShowWorkloadInNav(availability));

  const showWorkloadsSection = visibleWorkloads.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Logo / Header */}
      <div className="flex h-16 items-center gap-3 border-b px-5 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-sm tracking-tight">
            Mission Control
          </span>
          <span className="text-xs text-muted-foreground truncate">
            Unified AI usage dashboard
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 overflow-y-auto" aria-label="Main">
        {primaryNavItems.map((item) => (
          <NavItemLink
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            onNavigate={onNavigate}
          />
        ))}

        {showWorkloadsSection && (
          <div className="pt-3">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Workloads
            </p>
            <div className="space-y-1">
              {visibleWorkloads.map(({ item, availability }) => (
                <NavItemLink
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  onNavigate={onNavigate}
                  deemphasized={availability.navEmphasis === "deemphasized"}
                  badge={availability.navBadge}
                />
              ))}
            </div>
          </div>
        )}

        <div className={cn(showWorkloadsSection ? "pt-3" : "pt-1")}>
          <NavItemLink
            to={settingsNavItem.to}
            icon={settingsNavItem.icon}
            label={settingsNavItem.label}
            onNavigate={onNavigate}
          />
        </div>
      </nav>

      <SystemStatusFooter />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-9 w-9 rounded-lg"
    >
      {theme === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

function LogoutButton() {
  const { user, authEnabled, logout } = useAuth();
  if (!authEnabled || !user) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={logout}
      className="h-9 w-9 rounded-lg"
      title={`Logout (${user.username})`}
    >
      <LogOut className="h-4 w-4" />
      <span className="sr-only">Logout</span>
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
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Primary application navigation
          </SheetDescription>
          <Sidebar onNavigate={() => setIsMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-16 items-center gap-4 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 px-4 lg:px-6 sticky top-0 z-30">
          <Sheet>
            <SheetTrigger asChild className="lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Primary application navigation
              </SheetDescription>
              <Sidebar />
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          <SourceFilter />
          <LogoutButton />
          <ThemeToggle />
        </header>

        {/* Page Content — min-w-0 lets flex children shrink; do not clip overflow globally */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
