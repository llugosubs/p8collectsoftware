# MASTER PROMPT — P8 COLLECTS OS
## Software administrativo integral + tienda online para cartas y cajas coleccionables

---

## 0. INSTRUCCIONES DE USO EN CLAUDE CODE

1. Crea el repo vacío y guarda este archivo como `docs/MASTER_PROMPT.md`.
2. Primer comando en Claude Code: "Lee docs/MASTER_PROMPT.md completo. Genera el CLAUDE.md del proyecto siguiendo la sección 12. Luego entra en plan mode y propón el plan de la Fase 0. No escribas código hasta que apruebe."
3. Avanza fase por fase (sección 11). Cada fase termina con: tests en verde, migración aplicada, commit, resumen de lo hecho y lo pendiente.
4. Si el prompt no cubre algo, Claude Code debe proponer la decisión con justificación breve y esperar aprobación. No inventar reglas de negocio.

---

## 1. ROL

Actúas como arquitecto de software senior y desarrollador full-stack. Construyes un sistema administrativo integral de nivel producción para un negocio de compraventa de cartas coleccionables y cajas selladas. El estándar de calidad de referencia son sistemas administrativos SaaS comerciales (ventas, inventario, cuentas, cuentas pendientes, reportes, resumen financiero, CRM, multimoneda, multiplataforma, asistente IA), adaptados a un negocio de piezas únicas con valor de mercado variable.

---

## 2. CONTEXTO DEL NEGOCIO

- Marca: **P8 Collects**. Coleccionista y vendedor de cartas deportivas (NBA, NFL, MLB, soccer) y TCG (One Piece, Pokémon). Cartas graduadas (PSA, BGS, CGC, SGC), cartas raw, cajas selladas, y breaks.
- Operador: Luis Lugo. Base en Caracas, Venezuela. Estructura binacional Venezuela/EE. UU.
- Fuentes de compra: subastas online (Alt, Goldin, eBay, Whatnot, Fanatics Collect, PWCC), compra directa a particulares, retail sellado.
- Canales de venta: tienda online propia, Whatnot, Instagram/TikTok, venta presencial, eBay.
- Contexto venezolano obligatorio: operación en dos monedas (USD y Bs.), tasa BCV diaria, métodos de pago locales (Pago Móvil, transferencia Bs., Zelle, Binance/USDT, efectivo $), costos de importación (courier, aduana, IVA a la importación), restricciones de divisas.
- Costos reales de adquisición en subasta: hammer price + buyer's premium + fee por pago con tarjeta (ej. 3.3%) + envío internacional + courier/aduana Venezuela.
- Fase futura obligatoria en el diseño: **consignación de terceros** (vender cartas de otros coleccionistas cobrando comisión).

---

## 3. STACK TECNOLÓGICO (fijo, no cambiar sin aprobación)

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict, React Server Components |
| UI | Tailwind CSS 4 + shadcn/ui + lucide-react. Mobile-first |
| Base de datos | Supabase (Postgres 15+) |
| Auth | Supabase Auth (email + magic link + Google). Roles vía tabla `profiles` |
| Storage | Supabase Storage (bucket `cards` público con transformaciones, bucket `docs` privado) |
| Realtime | Supabase Realtime en inventario y ventas |
| Lógica server | Server Actions + Supabase Edge Functions (Deno) para webhooks y cron |
| Validación | Zod en todo input. Tipos generados con `supabase gen types` |
| Estado cliente | TanStack Query + Zustand solo donde haga falta |
| Tablas | TanStack Table con filtros, orden, paginación server-side |
| Gráficos | Recharts |
| PWA | next-pwa. Instalable en iOS/Android. Offline: lectura de inventario cacheado |
| Pagos exterior | Stripe Checkout |
| Pagos Venezuela | Manual con verificación (captura + referencia). Sin pasarela |
| Email | Resend |
| IA | Anthropic API (claude-sonnet) con tool use sobre la DB |
| Deploy | Vercel + Supabase Pro. GitHub Actions para CI |
| Tests | Vitest (unit), Playwright (e2e críticos), pgTAP para RLS |
| Monitoreo | Sentry + Vercel Analytics |

Idioma de la UI: español (Venezuela) por defecto, inglés para la tienda pública con selector. Textos en archivos i18n desde el inicio (`next-intl`).

---

## 4. ARQUITECTURA

Monorepo simple, una app Next.js con dos superficies:

```
/app
  /(admin)      → panel administrativo, protegido, PWA
  /(store)      → tienda pública P8 Collects, SSR/ISR, SEO
  /api          → webhooks (Stripe, Resend), endpoints IA
/lib
  /supabase     → clientes server/browser, tipos generados
  /domain       → reglas de negocio puras (costos, prorrateo, FX, comisiones)
  /validations  → schemas Zod
/supabase
  /migrations   → SQL versionado
  /functions    → edge functions
  /seed         → datos de prueba
/docs
```

Principios:
- Toda regla de negocio vive en `/lib/domain` como funciones puras con tests unitarios. La UI no calcula.
- Toda tabla con RLS activo. Nunca usar service role desde el cliente.
- Dinero: `numeric(14,4)` en DB, `Decimal.js` en app. Nunca float.
- Toda mutación pasa por Server Action con Zod y registra en `audit_log`.
- Soft delete (`deleted_at`) en entidades de negocio.

---

## 5. MODELO DE DATOS

Todas las tablas: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` (trigger), `created_by`, `deleted_at`.

### 5.1 Catálogo e inventario

**`items`** — unidad de inventario (carta, caja, lote, accesorio)
- `sku text unique` (autogenerado: `P8-{año}-{secuencia}`)
- `type enum('graded_card','raw_card','sealed_box','sealed_pack','lot','supply')`
- `category enum('sports','tcg','other')`
- `sport_or_game text` (NBA, NFL, MLB, Soccer, One Piece, Pokémon...)
- `player_or_character text`
- `brand text`, `set_name text`, `year int`, `card_number text`, `variant text` (parallel, insert, refractor, alt art...)
- `serial_numbered text` (ej. 15/99), `is_rookie bool`, `is_autograph bool`, `is_patch bool`
- `language text`
- `grading_company enum('PSA','BGS','CGC','SGC','TAG','none')`
- `grade numeric(3,1)`, `grade_label text` (Gem Mint, Pristine, Black Label)
- `cert_number text` (índice único cuando no es null)
- `raw_condition enum('NM','LP','MP','HP','DMG')`
- `quantity int default 1` (>1 solo para sealed/supply)
- `status enum('incoming','in_stock','listed','reserved','sold','consigned_out','returned','lost')`
- `location text` (Caracas, Miami, en tránsito, bóveda plataforma)
- `owner_type enum('own','consignment') default 'own'`
- `consignor_id uuid fk consignors null`
- `acquisition_id uuid fk acquisitions`
- `parent_item_id uuid fk items null` (para cartas que salen de un break)
- `cost_basis numeric(14,4)` (costo total prorrateado, calculado)
- `market_value numeric(14,4)`, `market_value_source text`, `market_value_at timestamptz`
- `list_price numeric(14,4)`, `min_price numeric(14,4)`
- `is_published bool`, `slug text unique`, `description_es text`, `description_en text`
- `tags text[]`
- `search_vector tsvector` (índice GIN)

**`item_images`** — `item_id`, `url`, `kind enum('front','back','cert','detail')`, `sort_order`

**`item_valuations`** — historial de valor de mercado: `item_id`, `value`, `source enum('manual','psa','ebay_sold','130point','tcgplayer','other')`, `note`, `valued_at`

### 5.2 Compras y adquisiciones

**`acquisitions`** — un lote de compra
- `platform enum('alt','goldin','ebay','whatnot','fanatics','pwcc','private','retail','other')`
- `reference text` (número de subasta/orden)
- `purchased_at date`, `currency char(3) default 'USD'`
- `hammer_total numeric`, `buyer_premium numeric`, `card_fee numeric`, `shipping_intl numeric`, `courier_ve numeric`, `customs_ve numeric`, `other_costs numeric`
- `total_cost numeric` (generado)
- `payment_status enum('pending','partial','paid')`
- `received_status enum('pending','in_transit','received','partial')`
- `notes text`

**`acquisition_lines`** — `acquisition_id`, `item_id`, `hammer_price numeric`, `allocated_cost numeric`

**Regla de prorrateo**: los costos comunes del lote (premium, fee tarjeta, envío, aduana) se distribuyen a cada línea en proporción a su `hammer_price`. `allocated_cost = hammer_price + (hammer_price / hammer_total) × costos_comunes`. Ese valor alimenta `items.cost_basis`.

### 5.3 Breaks

**`breaks`** — `source_item_id` (la caja), `opened_at`, `platform`, `revenue_from_spots numeric`, `notes`

**Regla**: al registrar un break, la caja pasa a `status='sold'` o `'consumed'` y se crean N `items` hijos con `parent_item_id`. El `cost_basis` de la caja se distribuye entre los hijos: por defecto en partes iguales, con opción de asignar manualmente por peso (los hits cargan más costo). Debe cuadrar al centavo.

### 5.4 Ventas

**`customers`** — nombre, email, teléfono/WhatsApp, país, ciudad, `id_document text`, `tags`, `notes`, `total_spent numeric` (vista), `is_wholesale bool`

**`orders`**
- `order_number text unique` (`P8O-{año}-{seq}`)
- `channel enum('store','whatnot','instagram','tiktok','ebay','in_person','other')`
- `customer_id`
- `status enum('draft','pending_payment','paid','packing','shipped','delivered','cancelled','refunded')`
- `currency char(3)`, `fx_rate numeric` (tasa usada si hay Bs.), `fx_rate_source text`
- `subtotal`, `discount`, `shipping_charged`, `platform_fee`, `payment_fee`, `tax`, `total`
- `shipping_method`, `tracking_number`, `shipping_cost_real`
- `notes`

**`order_lines`** — `order_id`, `item_id`, `quantity`, `unit_price`, `cost_basis_snapshot`, `gross_margin` (generado)

**`payments`** — `order_id` null si es pago de compra, `acquisition_id` null si es cobro
- `direction enum('in','out')`
- `method enum('zelle','pago_movil','transfer_bs','binance','cash_usd','cash_bs','stripe','paypal','card','other')`
- `currency`, `amount`, `fx_rate`, `amount_usd_equivalent`
- `reference text`, `proof_url text`
- `status enum('pending_verification','verified','rejected')`
- `account_id uuid fk accounts`

### 5.5 Finanzas

**`accounts`** — cuentas de dinero: `name`, `type enum('bank_ve','bank_us','zelle','binance','cash','platform_balance','card')`, `currency`, `opening_balance`, `is_active`

**`transactions`** — libro de movimientos: `account_id`, `type enum('sale','purchase','expense','transfer','fx_exchange','adjustment','consignor_payout')`, `amount`, `currency`, `fx_rate`, `amount_usd`, `reference_type`, `reference_id`, `category_id`, `description`, `occurred_at`, `reconciled bool`

**`expense_categories`** — supplies, envíos, suscripciones, marketing, grading fees, aduana, comisiones plataforma, otros

**`fx_rates`** — `date`, `source enum('bcv','binance','manual')`, `rate numeric`. Cron diario que consulta tasa BCV (scrape oficial o API pública; si falla, notificar y permitir carga manual).

**`receivables` / `payables`** — vistas derivadas de `orders` y `acquisitions` con saldo pendiente, vencimiento y días de mora.

### 5.6 Consignación (modelo desde fase 1, UI en fase 6)

**`consignors`** — datos del consignante, `commission_pct numeric`, `payout_method`, `payout_details jsonb`, `agreement_url`

**`consignment_agreements`** — `consignor_id`, `item_id`, `agreed_min_price`, `commission_pct` (override), `received_at`, `return_deadline`, `status enum('active','sold','returned','expired')`

**`consignor_payouts`** — `consignor_id`, `order_line_id`, `sale_price`, `commission_amount`, `net_to_consignor`, `status enum('pending','paid')`, `transaction_id`

**Regla**: la venta de un item con `owner_type='consignment'` genera automáticamente un `consignor_payout` pendiente y no cuenta el precio completo como ingreso propio; solo la comisión es ingreso de P8.

### 5.7 Sistema

**`profiles`** — `user_id`, `role enum('owner','admin','staff','viewer','consignor')`, `display_name`

**`audit_log`** — `table_name`, `record_id`, `action`, `old_data jsonb`, `new_data jsonb`, `user_id`, `at`

**`settings`** — clave/valor: comisión por defecto, fee tarjeta, moneda base, datos de la tienda, políticas

**`notifications`** — alertas internas (pago pendiente de verificar, item sin foto, lote sin recibir hace X días, cuenta por cobrar vencida)

---

## 6. REGLAS DE NEGOCIO (implementar en `/lib/domain` con tests)

1. **Costo total de adquisición**: suma de todos los componentes del lote en USD. Costos en Bs. (courier local, aduana) se convierten a la tasa del día del gasto y se guarda la tasa.
2. **Prorrateo** por proporción de hammer price (sección 5.2). Cuadre exacto al centavo con ajuste en la última línea.
3. **Margen por venta**: `unit_price − platform_fee − payment_fee − shipping_cost_real prorrateado − cost_basis_snapshot`.
4. **ROI por item y por lote**: `(ingreso neto − costo) / costo`.
5. **Valor de inventario**: dos cifras siempre visibles: a costo y a valor de mercado. Ganancia no realizada = diferencia.
6. **Multimoneda**: toda cifra se guarda en su moneda original más equivalente USD a la tasa registrada. Reportes en USD por defecto con toggle a Bs. a tasa del día. Reporte de **diferencial cambiario** cuando se cobra en Bs. y se convierte después.
7. **Reserva de stock**: al crear orden en la tienda, el item pasa a `reserved` por 24 h (configurable). Si no se verifica pago, vuelve a `listed`. Cron.
8. **Consignación**: comisión calculada al vender; precio mínimo del consignante bloquea ventas por debajo.
9. **Breaks**: el costo de la caja se conserva íntegro en la suma de los hijos.
10. **Fee de tarjeta**: porcentaje configurable en `settings` (default 3.3%), sugerido automáticamente al registrar una compra pagada con tarjeta.

---

## 7. MÓDULOS DEL PANEL ADMINISTRATIVO

Cada módulo: listado con filtros y búsqueda, detalle, creación/edición en drawer o página, acciones masivas, exportación CSV/Excel. Todo usable con una mano en el teléfono.

### 7.1 Dashboard (Resumen financiero)
KPIs del mes y del año: ventas, costo de ventas, margen bruto, gastos, utilidad neta, caja total por moneda, inventario a costo y a mercado, ganancia no realizada, cuentas por cobrar y por pagar, top 5 items por margen, ventas por canal, alertas.

### 7.2 Inventario
- Tabla con vista grid (fotos) y lista. Filtros: tipo, deporte/juego, gradadora, grado, estado, ubicación, owner, rango de valor.
- Ficha de item: fotos, datos, costo, valor de mercado con historial, timeline (compra → recepción → listado → venta), botón "publicar en tienda".
- Escaneo de cert PSA: input de cert number que consulta la API pública de PSA (si disponible) y precarga datos.
- Acción "abrir break" desde una caja.
- Importación masiva: ver módulo 7.12 (Importador semanal).
- Etiquetas imprimibles con QR al SKU.

### 7.3 Compras (Adquisiciones)
- Wizard: plataforma → datos del lote → líneas (carta y hammer) → costos comunes → prorrateo automático mostrado → confirmar.
- Estados de pago y de recepción. Alertas de lotes pagados no recibidos.
- Cuadro "pagado vs mercado" por lote.

### 7.4 Ventas
- POS rápido para venta presencial y por redes (buscar item, cliente, canal, método de pago, moneda, tasa).
- Órdenes de la tienda online entran aquí con verificación de pago (ver captura, marcar verificado).
- Flujo de estados con fechas y tracking.
- Registro de fees por canal (Whatnot, eBay) automático por configuración.

### 7.5 Cuentas (Tesorería)
- Saldos por cuenta y moneda. Movimientos. Transferencias entre cuentas. Cambio de divisas registrando tasa real.
- Conciliación manual: marcar movimientos como conciliados contra estado de cuenta.

### 7.6 Cuentas pendientes
- Por cobrar: órdenes con saldo. Por pagar: lotes de subasta pendientes, consignantes por liquidar, proveedores.
- Recordatorios por WhatsApp (link `wa.me` prellenado) y email.

### 7.7 Clientes (CRM)
- Ficha, historial, gasto total, frecuencia, wishlist (qué busca), notas. Segmentos.

### 7.8 Reportes
- Estado de resultados, ventas por período/canal/categoría, margen por item, rotación de inventario, aging de cuentas, diferencial cambiario, rendimiento por plataforma de compra, reporte para contador (exportable).

### 7.9 Consignación (fase 6)
- Consignantes, acuerdos, liquidaciones, portal de consignante (rol `consignor`) que ve solo sus items y sus pagos.

### 7.10 Asistente IA
- Chat en el panel. Claude con tool use: `query_inventory`, `query_sales`, `query_finance`, `query_customers`. Responde en lenguaje natural: "¿Cuánto gané con el lote de Alt de agosto?", "¿Qué One Piece tengo sin publicar?", "¿Cuánto tengo en Bs. y $?". Solo lectura. Genera borradores de descripciones de producto ES/EN a partir de la ficha.

### 7.11 Configuración
- Datos de la tienda, usuarios y roles, fees por canal, comisión por defecto, cuentas, categorías de gasto, plantillas de mensajes, políticas de envío, tasa manual.

### 7.12 Importador semanal de Excel (módulo crítico)

Objetivo: el dueño arma cada semana una tabla en Excel/Google Sheets con las cartas compradas. La sube y el sistema crea las adquisiciones, los items, el prorrateo de costos y las fotos pendientes, sin cargar nada a mano.

**Flujo en 4 pasos (wizard, funciona en móvil):**

1. **Subir archivo**: acepta `.xlsx`, `.csv` y pegar desde el portapapeles. Parser con SheetJS en el servidor. Detecta la hoja y la fila de encabezados aunque haya filas vacías arriba.
2. **Mapeo de columnas**: el sistema propone el mapeo automático por nombre de columna (fuzzy match ES/EN: "jugador", "player", "grado", "grade", "cert", "hammer", "precio"). El usuario corrige con selectores. El mapeo se guarda como **plantilla** por nombre (ej. "Excel Alt semanal") y se reutiliza la próxima semana sin volver a mapear.
3. **Validación y previsualización**: tabla con cada fila marcada como `nueva`, `duplicada`, `error` o `actualiza existente`. Reglas:
   - Duplicado si coincide `cert_number`, o si coincide `platform + reference + card_number + grade` para raw.
   - Filas duplicadas se omiten por defecto, con opción "actualizar precio/estado".
   - Errores bloqueantes: fila sin nombre de carta, hammer no numérico, grado fuera de rango. Se muestran inline y se puede corregir en la misma vista antes de confirmar.
   - Agrupación automática en **adquisiciones**: filas con misma `platform + reference (o fecha de subasta)` forman un lote. Los costos comunes del lote (premium, fee tarjeta, envío, aduana) se toman de columnas del Excel si existen o se piden una vez por lote en este paso. El prorrateo se calcula y se muestra antes de confirmar.
   - Cert PSA/BGS: si la fila trae cert, se intenta enriquecer con la API de la gradadora (set, año, número, pop) y se marca qué campos vinieron del cert.
4. **Confirmar**: transacción atómica en Postgres (todo o nada). Se crean `acquisitions`, `acquisition_lines`, `items` con `status='incoming'` (o `in_stock` si la columna "recibido" dice sí), SKU autogenerado, `cost_basis` calculado. Reporte final: N lotes, N items, total invertido, N filas omitidas, N con foto pendiente. Cada import queda registrado en **`import_batches`** con el archivo original guardado en Storage y opción de **revertir el lote completo** durante 7 días.

**Plantilla descargable** (`/admin/import/template.xlsx`) con estas columnas, en este orden, con ejemplos en la fila 2:

`fecha_compra | plataforma | referencia_subasta | tipo | deporte_o_juego | jugador_o_personaje | marca | set | año | numero | variante | serial | gradadora | grado | cert | condicion_raw | cantidad | hammer_usd | premium_usd | fee_tarjeta_pct | envio_usd | courier_ve_usd | aduana_usd | valor_mercado_usd | recibido | ubicacion | notas`

Las columnas de costos comunes se llenan solo en la primera fila de cada lote; el sistema las aplica al grupo.

**Tablas adicionales:**
- `import_templates` — `name`, `column_mapping jsonb`, `default_platform`, `last_used_at`
- `import_batches` — `file_url`, `template_id`, `rows_total`, `rows_created`, `rows_skipped`, `rows_error`, `summary jsonb`, `status enum('previewed','committed','reverted')`, `committed_at`
- `import_batch_rows` — `batch_id`, `row_number`, `raw_data jsonb`, `result enum('created','updated','skipped','error')`, `item_id`, `error_message`

**Extras:**
- Import por foto: subir foto de una lista o del slab y Claude (visión) extrae los campos a una fila de la previsualización. Siempre pasa por el paso 3.
- Sincronización opcional con Google Sheets: conectar una hoja y un botón "importar cambios desde la última vez" que solo trae filas nuevas o modificadas (por hash de fila).
- Exportación inversa: bajar el inventario completo en el mismo formato de la plantilla para editar en Excel y reimportar.

Este módulo se construye en la **Fase 2** junto con Inventario y Compras, con tests unitarios del parser, del mapeo fuzzy, de la detección de duplicados y del prorrateo por lote.

---

## 8. TIENDA PÚBLICA P8 COLLECTS

- Rutas: `/`, `/shop`, `/shop/[slug]`, `/cart`, `/checkout`, `/order/[number]`, `/about`, `/policies`.
- Catálogo con filtros (juego/deporte, gradadora, grado, precio, jugador/personaje), búsqueda, orden. ISR con revalidación al cambiar inventario.
- Ficha de producto: galería, datos de la carta, cert verificable (link a PSA/BGS), precio en USD con equivalente en Bs. a tasa del día, botón WhatsApp.
- Checkout: datos del cliente, envío (Venezuela: MRW/Zoom/Tealca/retiro; exterior: USPS/DHL), método de pago:
  - Zelle / Pago Móvil / Transferencia Bs. / Binance: muestra datos, el cliente sube captura y referencia, orden queda `pending_payment` con item `reserved`.
  - Stripe: pago inmediato, orden `paid`.
- Emails transaccionales: confirmación, pago verificado, enviado con tracking.
- SEO: metadata por producto, OpenGraph con la foto, sitemap, schema.org Product.
- Identidad visual: limpio, blanco con acento, monograma P8 y wordmark separados (nunca juntos), tipografía Montserrat. Logo se entrega como SVG.
- Bilingüe ES/EN.

---

## 9. SEGURIDAD Y CALIDAD

- RLS en todas las tablas. Políticas por rol. Tests pgTAP que verifiquen que `staff` no ve costos, `viewer` no escribe, `consignor` solo ve lo suyo, anónimo solo ve items `is_published`.
- Rate limiting en checkout y endpoints IA.
- Validación Zod en cliente y servidor. Sanitizar uploads (tipo, tamaño, EXIF strip).
- Backups: Supabase PITR en plan Pro + export semanal a Storage.
- Variables de entorno documentadas en `.env.example`. Nunca commitear secretos.
- Accesibilidad: contraste AA, navegación por teclado, labels.
- Performance: Lighthouse móvil > 90 en tienda. Imágenes vía transformaciones de Supabase.
- Logs de auditoría en toda mutación de dinero e inventario.

---

## 10. UX MÓVIL

- Bottom nav en admin: Dashboard, Inventario, Vender, Compras, Más.
- Acción rápida flotante: "registrar venta", "agregar carta con foto" (cámara directa).
- Formularios en pasos cortos. Inputs numéricos con teclado numérico. Selector de moneda visible.
- Modo offline: consulta de inventario y creación de borradores que sincronizan al reconectar.

---

## 11. FASES DE CONSTRUCCIÓN

**Fase 0 — Fundación**: repo, Next.js, Supabase, Auth, roles, layout admin y store, CI, Sentry, i18n, CLAUDE.md, `.env.example`.

**Fase 1 — Modelo de datos completo**: todas las migraciones (incluida consignación), RLS, tipos generados, seed con el lote real de Alt de agosto 2026 (~15 cartas PSA 10, ver `docs/seed-alt-ago-2026.csv`), tests pgTAP.

**Fase 2 — Inventario + Compras + Importador**: módulos 7.2, 7.3 y 7.12, prorrateo, fotos, breaks, plantilla Excel, mapeo guardado, detección de duplicados, reversión de lotes, etiquetas QR.

**Fase 3 — Ventas + Clientes + Tesorería**: 7.4, 7.5, 7.7, pagos con verificación, FX diario, cuentas pendientes 7.6.

**Fase 4 — Tienda pública**: sección 8 completa, Stripe, emails, SEO.

**Fase 5 — Dashboard + Reportes + IA**: 7.1, 7.8, 7.10, exportaciones.

**Fase 6 — Consignación**: 7.9 y portal de consignante.

**Fase 7 — Endurecimiento**: PWA offline, Playwright e2e, Lighthouse, backups, documentación de operación.

Cada fase entrega: migraciones, código, tests, `docs/CHANGELOG.md` actualizado y demo en Vercel preview.

---

## 12. CLAUDE.md (generar en Fase 0)

Debe contener:
- Resumen del proyecto y enlace a este master prompt.
- Comandos: dev, test, lint, typecheck, `supabase db push`, `supabase gen types`, seed.
- Convenciones: nombres en inglés en código y DB, UI en español; commits Conventional Commits; una migración por cambio; ninguna regla de negocio fuera de `/lib/domain`; nunca `any`; nunca float para dinero.
- Regla de trabajo: antes de cada fase, plan mode y aprobación. Después de cada fase, resumen y pendientes.
- Lista de decisiones abiertas que requieren pregunta al dueño.

---

## 13. DATOS DE ARRANQUE

- Fee tarjeta default: 3.3%.
- Moneda base: USD. Segunda moneda: VES.
- Fuente FX: BCV (oficial), con alternativa Binance P2P para referencia.
- Comisión consignación default: 15% (ajustable).
- Canales iniciales: store, whatnot, instagram, in_person.
- Cuentas iniciales: Zelle, Banco VE (Bs.), Binance, Efectivo $, Tarjeta (para compras).
- Plataformas de compra iniciales: Alt, eBay, Whatnot, Goldin.
