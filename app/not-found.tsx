import Link from "next/link";

import { BrandMark } from "@/components/brand/brand-mark";
import { JetBrains_Mono, Montserrat } from "next/font/google";

import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/** Cifras, precios, IDs y tablas. Sin esto las columnas de dinero bailan. */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-brand",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/**
 * Con dos root layouts (panel y tienda), el not-found de la raíz tiene que traer
 * su propio `<html>` y `<body>`: no hereda ninguno de los dos.
 */
export default function NotFound() {
  return (
    <html
      lang="es"
      data-theme="dark"
      className={`${montserrat.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4 antialiased">
        <div className="max-w-md text-center">
          <BrandMark height={22} className="mx-auto" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Página no encontrada</h1>
          <p className="text-muted-foreground mt-2">
            El enlace no existe o cambió de sitio. / This page doesn&apos;t exist.
          </p>
          <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">
            Volver al inicio
          </Link>
        </div>
      </body>
    </html>
  );
}
