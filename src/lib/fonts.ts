import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";

export const fontSans = GeistSans;
export const fontMono = GeistMono;

export const feijoaDisplay = localFont({
  src: "../fonts/Feijoa_Display.otf",
  variable: "--font-feijoa",
  weight: "400",
  display: "swap",
});

export const obviouslyRegular = localFont({
  src: "../fonts/Obviously-Regular.otf",
  variable: "--font-obviously",
  weight: "400",
  display: "swap",
});

export const obviouslySemiBold = localFont({
  src: "../fonts/Obviously-Semibold.otf",
  variable: "--font-obviously-semibold",
  weight: "600",
  display: "swap",
});
