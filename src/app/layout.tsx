import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resource Planner & Project P&L",
  description: "Calendar bookings with OT and site/factory, double-booking guards, bench & multi-month P&L.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
