import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Lynx LinkedIn Agent",
  description: "Pipeline + engagement loop for Lynx Media's LinkedIn agent.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        {user ? <Header /> : null}
        <main>{children}</main>
      </body>
    </html>
  );
}
