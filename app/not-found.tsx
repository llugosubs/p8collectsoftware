import Link from "next/link";
import { Montserrat } from "next/font/google";

import "./globals.css";

const montserrat = Montserrat({ variable: "--font-sans", subsets: ["latin"], display: "swap" });

/**
 * Con dos root layouts (panel y tienda), el not-found de la raíz tiene que traer
 * su propio `<html>` y `<body>`: no hereda ninguno de los dos.
 */
export default function NotFound() {
  return (
    <html lang="es" className={montserrat.variable}>
      <body className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4 antialiased">
        <div className="max-w-md text-center">
          <p className="text-sm font-semibold tracking-[0.2em] uppercase">P8 Collects</p>
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
