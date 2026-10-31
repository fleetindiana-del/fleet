"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { useSidebar } from "@/components/layout/SidebarContext";
import { cn } from "@/lib/utils";

const FULLSCREEN_MAP_ROUTES = ["/fleet-map", "/trips"];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMapFullscreen = FULLSCREEN_MAP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  const { isCollapsed, toggleCollapsed } = useSidebar();
  const prevCollapsedRef = useRef<boolean | null>(null);

  // Auto-collapse the sidebar on map pages so the map gets more room.
  useEffect(() => {
    if (isMapFullscreen) {
      if (prevCollapsedRef.current === null) {
        prevCollapsedRef.current = isCollapsed;
      }
      if (!isCollapsed) toggleCollapsed();
      return;
    }

    if (prevCollapsedRef.current === false && isCollapsed) {
      toggleCollapsed();
    }
    prevCollapsedRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapFullscreen]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
      {!isMapFullscreen && <Navbar />}
      <main
        id="dashboard-scroll-container"
        className={cn(
          "flex-1 relative min-w-0",
          isMapFullscreen ? "overflow-hidden p-0" : "overflow-x-hidden overflow-y-auto p-4 sm:p-6 md:p-8"
        )}
      >
        {children}
      </main>
    </div>
  );
}
