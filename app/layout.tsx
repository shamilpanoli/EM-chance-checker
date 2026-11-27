import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: "Erasmus Mundus Profile Scorer",
  description: "Upload your resume and get a free Erasmus Mundus scholarship readiness score out of 100.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7c6fe6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className="font-sans antialiased min-h-dvh">
        <div className="phone-stage">
          <div className="phone-frame">
            <div className="phone-scroll">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
