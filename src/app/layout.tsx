import type { Metadata } from "next";
import { Montserrat, Figtree } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import ThemeInit from "@/components/ThemeInit";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-heading-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const figtree = Figtree({
  variable: "--font-body-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Needs Signal Survey — Boldly Go Beyond",
  description: "Discover the psychological needs that matter most to you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeInit />
        {children}
      </body>
      {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
      )}
    </html>
  );
}
