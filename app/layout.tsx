import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clinic Translator",
  description: "HIPAA-compliant Spanish↔English real-time translator for clinic calls.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased overflow-x-hidden">{children}</body>
    </html>
  );
}
