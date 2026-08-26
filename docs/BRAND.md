# P8 COLLECTS · Guía de marca para producto (v1, ago 2026)

Marca de cartas coleccionables: breaks, ventas y subastas. Tono: premium, minimal, editorial. Sin degradados, sin brillos, sin texturas en la interfaz.

## Paleta

| Token    | Hex     | Uso                                                    |
| -------- | ------- | ------------------------------------------------------ |
| charcoal | #0D0D0D | Fondo principal (tema oscuro por defecto)              |
| cream    | #EFE6D3 | Texto sobre oscuro, fondo del tema claro               |
| gold     | #C9A96E | Acento único: CTAs, precios destacados, bordes de hits |
| green    | #0F2A1E | Tema "Vault" (inventario premium / gradeadas)          |

Regla: un solo acento por pantalla. El dorado marca lo que importa; si todo es dorado, nada lo es. Rojo, amarillo y verde semánticos solo para estados del sistema.

## Temas

- `dark` (default): admin y tienda.
- `light`: facturas, PDF para el socio, impresión.
- `vault`: sección premium. Mismo layout, fondo verde.
  Implementado con `data-theme` en `<html>`. Los componentes usan solo `--bg --surface --text --muted --accent`, nunca hex directos.

## Tipografía

- UI y texto: **Montserrat** (Google Fonts). Pesos 400 / 500 / 600. Titulares en 600 con tracking -0.01em. Etiquetas y eyebrows en mayúsculas con tracking 0.22em.
- Números, precios, IDs, tablas: **JetBrains Mono** con `tabular-nums`.
- Script: la palabra "Collects" del logo NO se renderiza como texto. Se usa siempre el PNG del lockup. `Kaushan Script` queda como fallback solo para frases decorativas de marketing, nunca en la UI.

## Logo en producto

- Header oscuro: `assets/p8_lockup_script_transparente_oscuro_2048.png`, alto 36 a 44 px.
- Fondo claro / facturas: `assets/p8_lockup_script_transparente_claro_2048.png`.
- Watermark en fotos de cartas: `assets/p8_lockup_script_blanco_watermark_2048.png` al 40 %, esquina inferior derecha, 12 % del ancho de la foto.
- Favicon y app icon: `assets/favicon/`. A 32 px solo se lee el P8; aceptado.
- Avatar de LL: `assets/p8_avatar_transparente.png`. Solo en "Sobre nosotros", lives y contenido; nunca en la UI operativa.
  Zona de protección: la altura de la letra P alrededor del lockup. Nunca estirar, recolorear ni separar P8 de "Collects".

## Estados de inventario (badge outline, texto en mayúsculas)

available · dorado — reserved · ámbar — sold · gris — consigned · verde claro — auction · rojo

## Componentes base

- Card de carta: aspect 2.5/3.5, radio 10 px, borde 1 px `--border`; si es hit, borde `--accent`.
- Slab (gradeada): aspect 3.25/5.25.
- Botón primario: fondo dorado, texto charcoal, mayúsculas con tracking.
- Botón ghost: borde dorado, texto dorado.
- Tablas: filas de 44 px, cifras en mono alineadas a la derecha, moneda con símbolo ($ / Bs) antes del número.

## Moneda y formato

- Precios en $ con dos decimales; Bs sin decimales. Mostrar tasa del día junto a totales mixtos.
- Fechas dd/mm/yyyy. Zona horaria America/Caracas.

## Archivos

- `tokens.json`: fuente de verdad. `tokens.css`: variables + clases base. `tailwind.preset.js`: preset para Next/Tailwind.
- Cargar fuentes: `<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`
