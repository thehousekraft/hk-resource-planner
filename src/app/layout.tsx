import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resource Planner & Project P&L",
  description: "Calendar bookings with OT and site/factory, double-booking guards, bench & multi-month P&L.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
