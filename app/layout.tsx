import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reviewify — AI Mock Interview",
  description: "Voice-based AI mock interviews tailored to your resume and the job description.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0b0f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" /> Reviewify
            </a>
            <span className="text-xs text-muted">AI mock interviews</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
