import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DomainRadar",
  description: "Namecheap marketplace domain scraper & trend tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full min-h-screen bg-background">
        <SidebarProvider>
          <AppSidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Top bar with sidebar toggle */}
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <div className="h-4 w-px bg-border" />
              <span className="text-sm text-muted-foreground">
                Namecheap Market Tools
              </span>
            </header>
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
