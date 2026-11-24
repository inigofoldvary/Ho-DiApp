import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ho-DiApp",
  description: "Registra quién ha pagado cada cosa de tu casa compartida.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6f5e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="antialiased">
        <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10">{children}</div>
      </body>
    </html>
  );
}
