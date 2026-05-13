import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Lynx LinkedIn Agent",
  description: "Pipeline + engagement loop for Lynx Media's LinkedIn agent.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <Sidebar />
        <main className="min-w-0">{children}</main>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
