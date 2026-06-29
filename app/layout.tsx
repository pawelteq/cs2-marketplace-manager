import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CS2 Marketplace Manager",
  description: "Porównywarka cen skinów CS2 między marketami (Skinport, CSFloat)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
