import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { NavbarCountProvider } from "@/components/layout/NavbarCountContext";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  // Drivers shouldn't access the web dashboard, route them to their mobile portal
  if (session.user.role === "driver") {
    redirect("/driver/add-expense");
  }

  return (
    <SidebarProvider>
      <NavbarCountProvider>
        <div className="flex h-screen bg-slate-950 overflow-hidden font-sans text-slate-300">
          <Sidebar role={session.user.role} />
          <DashboardShell>{children}</DashboardShell>
        </div>
      </NavbarCountProvider>
    </SidebarProvider>
  );
}
