import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { RoleProvider } from "@/lib/role";
import TopBar from "@/components/TopBar";

export const metadata: Metadata = {
  title: "Inline Copilot",
  description:
    "Check content against approved brand guidelines, terms and facts before it is published. AI suggests, humans decide.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <RoleProvider>
          <TopBar />
          <main id="main" className="container">
            {children}
          </main>
        </RoleProvider>
      </body>
    </html>
  );
}
