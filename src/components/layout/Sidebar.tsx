"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Map, Navigation, Phone, UserCog, FileText, X, Activity, Contact, Trash2, PieChart, BrainCircuit, BotMessageSquare, ScrollText, UserCheck, Smartphone, PhoneCall, Building2, UsersRound, ChevronLeft, ChevronRight, Car, QrCode, Satellite, Wallet, Clock, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./SidebarContext";
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

const sidebarNavItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Drivers", href: "/drivers", icon: Users },
  { title: "Expenses", href: "/expenses", icon: Wallet },
  { title: "Driver Shifts", href: "/shifts", icon: Clock },
  { title: "Tracking Alerts", href: "/tracking-alerts", icon: Siren },
  { title: "Fleet GPS", href: "/fleet-map", icon: Satellite },
  { title: "Route History", href: "/trips", icon: Navigation },
  { title: "Vehicles", href: "/vehicles", icon: Car },
  { title: "Device Enrollment", href: "/enrollment", icon: QrCode },
  { title: "Expense Map", href: "/live-map", icon: Map },
  { title: "Call Logs", href: "/call-logs", icon: Phone },
  { title: "Call Tracker", href: "/call-tracker", icon: PhoneCall },
  { title: "Analytics", href: "/analytics", icon: PieChart },
  { title: "Contact Intelligence", href: "/contact-intelligence", icon: BrainCircuit },
  { title: "Identified Contacts", href: "/identified-contacts", icon: UserCheck },
  { title: "Telegram Setup", href: "/telegram-setup", icon: BotMessageSquare },
  { title: "Bot Logs", href: "/bot-logs", icon: ScrollText },
  { title: "App Active Status", href: "/toggle-logs", icon: Activity },
  { title: "Phone App Logs", href: "/device-app-logs", icon: Smartphone },
  { title: "Contact Bank", href: "/contacts", icon: Contact },
  { title: "User Management", href: "/users", icon: UserCog },
  { title: "Department Master", href: "/departments", icon: Building2 },
  { title: "Employee → Department", href: "/employee-departments", icon: UsersRound },
  { title: "Reports", href: "/reports", icon: FileText },
  { title: "Test Data", href: "/test-data", icon: Trash2 },
];

/**
 * HR staff only see the pages they need for advances and expense approvals.
 * This trims the menu; it is not an access boundary by itself (the income-expense
 * API enforces its own role check).
 */
const HR_NAV_HREFS = ["/expenses", "/drivers", "/shifts", "/tracking-alerts"];

export function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const navItems = useMemo(
    () => (role === "hr" ? sidebarNavItems.filter((i) => HR_NAV_HREFS.includes(i.href)) : sidebarNavItems),
    [role]
  );
  const { isOpen, close, isCollapsed, toggleCollapsed, sidebarWidth, setSidebarWidth } = useSidebar();

  const collapsedWidth = 72;
  const minWidth = 220;
  const maxWidth = 420;

  const computedWidth = useMemo(() => {
    if (isCollapsed) return collapsedWidth;
    const clamped = Math.max(minWidth, Math.min(maxWidth, sidebarWidth));
    return clamped;
  }, [isCollapsed, sidebarWidth]);

  // keep stored width clamped (esp. after window size / config changes)
  useEffect(() => {
    if (isCollapsed) return;
    if (computedWidth !== sidebarWidth) setSidebarWidth(computedWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedWidth, isCollapsed]);

  const dragStateRef = useRef<{
    startX: number;
    startWidth: number;
    dragging: boolean;
  } | null>(null);

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (isCollapsed) return;
      if (e.button !== 0) return;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      dragStateRef.current = {
        startX: e.clientX,
        startWidth: computedWidth,
        dragging: true,
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [computedWidth, isCollapsed]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st?.dragging || isCollapsed) return;
      const next = st.startWidth + (e.clientX - st.startX);
      const clamped = Math.max(minWidth, Math.min(maxWidth, next));
      setSidebarWidth(Math.round(clamped));
    };

    const onUp = () => {
      const st = dragStateRef.current;
      if (!st?.dragging) return;
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isCollapsed, setSidebarWidth]);

  return (
    <>
      {/* ── Mobile backdrop overlay ── */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-300 sm:hidden",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* ── Sidebar panel ── */}
      <nav
        className={cn(
          // Base styles — always present
          "relative flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-300 z-40",
          // Desktop: static, always visible, fixed width
          "sm:relative sm:top-auto sm:left-auto sm:bottom-auto sm:translate-x-0 sm:w-[var(--sidebar-width)] sm:flex sm:flex-shrink-0",
          // Mobile: fixed drawer, slides in/out
          "fixed top-0 left-0 bottom-0 w-72 transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
        )}
        style={
          {
            "--sidebar-width": `${computedWidth}px`,
          } as CSSProperties
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-800 font-bold text-xl tracking-tight text-white flex-shrink-0">
          <div className={cn("flex items-center gap-2 min-w-0", isCollapsed && "sm:justify-center sm:w-full")}>
            <span className={cn("truncate", isCollapsed && "sm:hidden")}>FleetSaaS</span>
            <span className={cn("hidden sm:inline text-indigo-300/90", !isCollapsed && "sm:hidden")} aria-hidden="true">
              FS
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Collapse toggle — desktop only */}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden sm:inline-flex p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>

            {/* Close button — only shown on mobile */}
            <button
              onClick={close}
              className="sm:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname?.startsWith(item.href));
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close} // auto-close on mobile after navigation
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all",
                      isCollapsed && "sm:justify-center sm:px-2",
                      isActive
                        ? "bg-indigo-600 font-medium text-white shadow-sm"
                        : "hover:bg-slate-800 hover:text-white"
                    )}
                    title={isCollapsed ? item.title : undefined}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className={cn("truncate", isCollapsed && "sm:hidden")}>{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={cn("p-4 border-t border-slate-800 text-xs text-slate-500 text-center flex-shrink-0", isCollapsed && "sm:hidden")}>
          © 2026 Admin Panel
        </div>

        {/* Desktop resize handle */}
        {!isCollapsed && (
          <div
            className="hidden sm:block absolute top-0 right-0 h-full w-2 cursor-col-resize bg-transparent hover:bg-indigo-500/20 active:bg-indigo-500/30 transition-colors"
            onPointerDown={onResizePointerDown}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            tabIndex={-1}
          />
        )}
      </nav>
    </>
  );
}
