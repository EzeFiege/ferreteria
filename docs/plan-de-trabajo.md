# Plan de trabajo — Sistema de caja y gestión para ferreterías

Cómo usar este archivo: cada etapa tiene un objetivo, una división de trabajo entre agentes y un prompt listo para pegar. Se avanza de a una etapa; no se empieza la siguiente hasta cumplir los criterios de aceptación. Las reglas permanentes están en `AGENTS.md`.

Punto de partida: el Excel de referencia es de una librería y se usa solo como modelo de la lógica de caja (apertura, ventas por medio de cobro, gastos y saldo de caja que pasa de un día al siguiente). Sus columnas Kiosko y Saldo no aplican y no se modelan. Los rubros, categorías, medios de pago y plazos de acreditación reales de la ferretería se cargan en la Etapa 4.

---

## Etapa 0 — Base del proyecto (Completada ✅)

Objetivo: repo que compila, con CI, base local y la migración 001 aplicada.

| Agente | Zona | Tarea |
|---|---|---|
| A | raíz, `.github/` | Monorepo pnpm, TypeScript estricto, eslint, CI (typecheck, lint, test) |
| B | `db/`, `apps/api` | Docker Compose con PostgreSQL, script `db:migrate`, rol de aplicación sin privilegios (ver nota de RLS en la migración) |

Prompt:
> Leé AGENTS.md y db/migrations/001_core_caja.sql. Creá el monorepo con apps/api, apps/web y packages/shared, con TypeScript estricto, eslint y un workflow de CI que ejecute typecheck, lint y test. Agregá un docker-compose con PostgreSQL 16 y un script `pnpm db:migrate` que aplique las migraciones en orden. Creá un rol `app_user` sin superusuario ni bypassrls para que la API lo use. Mostrame el plan antes de escribir código.

Aceptación: `pnpm install && pnpm db:migrate && pnpm test` funciona en limpio; la CI queda en verde.

Estado:
- [x] Monorepo configurado con `pnpm-workspace.yaml` (`apps/api`, `apps/web`, `packages/shared`).
- [x] `tsconfig.base.json` con chequeo estricto y `eslint.config.mjs` con `strictTypeChecked`.
- [x] Workflow de CI en `.github/workflows/ci.yml` con servicio PostgreSQL 16, `pnpm db:migrate`, `pnpm typecheck`, `pnpm lint` y `pnpm test`.
- [x] `docker-compose.yml` con PostgreSQL 16 (`postgres:16-alpine`).
- [x] Migraciones `db/migrations/001_core_caja.sql` y `db/migrations/002_rol_app_user.sql` (`app_user` con `NOSUPERUSER NOBYPASSRLS`) y ejecutor `pnpm db:migrate`.

---

## Etapa 1 — Núcleo de caja (API + pruebas) (Completada ✅)

Objetivo: toda la lógica de caja disponible por API y verificada con tests.

Endpoints mínimos: abrir turno (sugiere el efectivo contado del último cierre), registrar venta (con uno o varios medios de pago), registrar egreso, retiro/ingreso extra, revertir movimiento, cerrar turno con arqueo, resumen del turno.

Prompt:
> Implementá en apps/api el núcleo de caja respetando las reglas inviolables de AGENTS.md. Cada pedido corre en una transacción que fija `app.negocio_id` desde el token. Los ids de venta y movimiento vienen del cliente y los inserts son idempotentes. Escribí tests contra PostgreSQL real que reproduzcan el caso del Excel: ventas por $2.600, $200 y $3.300 en efectivo y $4.700 en tarjeta, y comprobá que el efectivo esperado es $6.100 y que la venta con tarjeta no suma al cajón. Agregá tests de reversión, venta con pago mixto (efectivo y tarjeta), turno cerrado, reintento con el mismo id, y aislamiento entre dos negocios.

Aceptación: todos los tests pasan; ningún endpoint modifica ni borra movimientos; el resumen de turno coincide con el cálculo manual.

Estado:
- [x] Esquema Drizzle (`apps/api/src/db/schema.ts`) y contexto transaccional RLS (`apps/api/src/db/context.ts`) con `set local role app_user` y `set_config('app.negocio_id', $1, true)` desde el token.
- [x] Aritmética entera en centavos (`bigint`) y esquemas Zod en `packages/shared/src/index.ts`.
- [x] Endpoints implementados en `apps/api/src/routes/caja.ts`: sugerencia de apertura (`GET /cajas/:cajaId/sugerencia-apertura`), apertura de turno (`POST /turnos/abrir`), venta simple y mixta idempotente (`POST /ventas`), egreso (`POST /movimientos/egreso`), retiro (`POST /movimientos/retiro`), ingreso extra (`POST /movimientos/ingreso-extra`), reversión inmutable (`POST /movimientos/:movimientoId/revertir`), cierre con arqueo (`POST /turnos/:turnoId/cerrar`) y resumen de turno (`GET /turnos/:turnoId/resumen`).
- [x] Suite de pruebas contra PostgreSQL 16 real (`apps/api/src/routes/caja.test.ts`) cubriendo el caso del Excel ($6.100 en efectivo + $4.700 en tarjeta), reversión, pagos mixtos, turno cerrado, idempotencia de reintentos y aislamiento multi-negocio.

---

## Etapa 2 — Interfaz del cajero (Completada ✅)

Objetivo: pantalla rápida de mostrador, usable en celular y en PC.

| Agente | Zona | Tarea |
|---|---|---|
| A | `apps/web` | Login, apertura de turno, pantalla de venta rápida (descripción + monto + medio de pago + rubro), egresos, cierre con arqueo |
| B | `apps/web` (sin pisar a A) | Cola local offline con IndexedDB y sincronización con reintentos idempotentes |

Prompt:
> Construí en apps/web la pantalla de caja: abrir turno, cargar ventas con teclado numérico grande, elegir medio de pago y rubro con un toque, registrar egresos con categoría, y cerrar el turno contando el efectivo (mostrar esperado, contado y diferencia). Debe cargar una venta en menos de cinco toques. Si no hay internet, las operaciones quedan en una cola local y se sincronizan después usando los mismos ids. Probala en el navegador integrado con el flujo completo y adjuntá capturas.

Aceptación: flujo completo en el navegador; funciona con la conexión cortada y sincroniza al volver sin duplicar.

Estado:
- [x] Pantalla de mostrador (`apps/web/src/App.tsx`): login de operador, apertura de turno con sugerencia del último cierre, venta rápida en menos de 5 toques con teclado numérico grande y botones de 1 toque para medio de pago y rubro, registro de egresos por categoría, y cierre con arqueo (efectivo esperado, contado y diferencia).
- [x] Cola local offline en IndexedDB (`apps/web/src/offline/cola-indexeddb.ts`) con sincronización FIFO idempotente conservando los UUIDs generados en el cliente.
- [x] Flujo completo probado de punta a punta en navegador Chrome contra la API y PostgreSQL 16 con capturas de cada paso.

---

## Etapa 3 — Reportes e historial (Completada ✅)

Objetivo: que el dueño vea lo que hoy sacaría de la planilla, sin armarlo a mano.

- Reporte del turno y del día (totales por medio de pago y rubro, egresos, efectivo esperado, diferencia de arqueo).
- Historial de turnos y de diferencias por cajero.
- Importador de planillas históricas: opcional, solo si la ferretería llega con registros propios; el formato se define con una muestra real.

Prompt:
> Agregá los reportes del turno y del día (vistas v_resumen_turno y v_ventas_por_medio_rubro) y una pantalla de historial con filtros por fecha, caja y cajero. No construyas el importador hasta que haya una planilla real de la ferretería para tomar como muestra.

Aceptación: los totales de un día cargado a mano coinciden con el cálculo manual de efectivo, tarjeta y transferencias.

Estado:
- [x] Endpoints `GET /reportes/dia` y `GET /reportes/historial-turnos` en `apps/api/src/routes/reportes.ts` basados en `v_resumen_turno` y `v_ventas_por_medio_rubro`, con filtros por fecha (`fecha`, `fechaDesde`, `fechaHasta`), `cajaId` y `cajeroId`, más diferencias de arqueo acumuladas por cajero.
- [x] Pantalla de Reportes e Historial en `apps/web/src/ReportesHistorial.tsx` integrada en `apps/web/src/App.tsx`.
- [x] Pruebas de integración contra PostgreSQL 16 real (`apps/api/src/routes/reportes.test.ts`) comprobando que un día cargado con ventas en Efectivo, Tarjeta y Transferencia/QR más egresos y arqueo coincide exactamente con el cálculo manual.
- [ ] Importador de planillas históricas: en espera de muestra real de la ferretería (`TODO(definir)`).

---

## Etapa 4 — Piloto en paralelo (Infraestructura lista ✅ · En ejecución de 14 días)

Objetivo: probar con una caja real, cargando en el sistema y en el registro actual del negocio (planilla o cuaderno) a la vez durante dos semanas.

- Desplegar API y web (con confirmación humana para cada paso).
- Backups automáticos de la base y prueba de restauración.
- Monitoreo de errores y alertas básicas.
- Cargar rubros, categorías y medios de pago reales de la ferretería, con sus días de acreditación y comisiones.
- Cada día: comparar el cierre del sistema contra el registro actual y anotar las diferencias.

Aceptación: dos semanas sin diferencias inexplicadas; el cajero prefiere el sistema al registro anterior.

Estado:
- [x] Artefactos de despliegue para Railway preparados (`Dockerfile`, `.dockerignore`, `railway.json` con healthcheck en `/health/ready`); el despliegue a nube requerirá confirmación humana previa en cada paso.
- [x] Script de backup lógico y prueba automatizada de restauración cronológica (`apps/api/src/db/backup-restore.ts` y `pnpm db:backup:verify`) que restaura en una base PostgreSQL 16 temporal y verifica conteos, vistas y RLS (`app_user`).
- [x] Monitoreo de errores y alertas estructuradas con `pino` (`alerta: true`) en `apps/api/src/server.ts` y endpoint `GET /health/ready` en `apps/api/src/routes/configuracion.ts`.
- [x] Endpoints protegidos por rol `dueno` (`POST /configuracion/medios-pago`, `POST /configuracion/rubros`, `POST /configuracion/categorias`) y pantalla `ConfiguracionPiloto.tsx` para cargar medios de pago reales con `dias_acreditacion` y `comision_pct`, rubros y categorías.
- [x] Bitácora diaria de conciliación del piloto en paralelo (Sistema vs. Planilla/Cuaderno) integrada en la pestaña `5. Config. y Piloto` (`apps/web/src/ConfiguracionPiloto.tsx`).

---

## Fase 2 — Catálogo, fraccionamiento y stock vivo (Backend completado ✅)

Objetivo: control de stock en tiempo real por kardex inmutable, fraccionamiento de unidades (ej. metro/rollo), listas de precios por margen sobre costo y lectura con pistola/QR.

Estado:
- [x] Migración `003_catalogo_stock.sql`: tablas `producto`, `producto_codigo_barra`, `lista_precio`, `movimiento_stock` inmutable con trigger, vistas `v_stock_actual` y `v_precios_producto`, y RLS activo.
- [x] Esquemas compartidos en `packages/shared`: productos, códigos de barra, fraccionamiento, listas de precio y `itemVentaInputSchema` enriquecido con `productoId`, `unidad` y descuentos.
- [x] Servicio de autocompletado y lookup EAN (`catalog-lookup.ts`) con integración a la API de Mercado Libre.
- [x] Endpoints en `apps/api/src/routes/productos.ts` (`GET /productos/lookup-ean/:codigo`, `GET /productos`, `POST /productos`, `PUT /productos/:id`, `POST /stock/ajuste`, `GET/PUT /listas-precios`).
- [x] Integración en `apps/api/src/routes/caja.ts`: egreso automático de stock al vender ítems con `productoId` (descontando fraccionado según `factor_conversion`).
- [x] Suite de 8 tests de integración (`apps/api/src/routes/productos.test.ts`) pasando al 100% contra PostgreSQL 16 real.

---

## Fase 3 — CRM y Cuenta Corriente de Clientes (Completada ✅)

Objetivo: gestión de clientes (albañiles, gremio, constructoras), personas autorizadas a retirar mercadería, libro de cuenta corriente inmutable (solo agregar) y cobranzas integradas en el turno de caja.

Estado:
- [x] Migración `004_clientes_cuenta_corriente.sql`: ampliación de tabla `cliente`, tabla `cliente_autorizado`, tabla inmutable `movimiento_cta_cte` con trigger SQL que bloquea `UPDATE` y `DELETE`, vista `v_saldo_cliente` con cálculo en tiempo real de débitos, créditos, saldo deudor y crédito disponible, sembrado de medio de pago 'Cuenta Corriente' y RLS activo.
- [x] Esquemas compartidos en `packages/shared`: `guardarClienteSchema`, `guardarClienteAutorizadoSchema`, `registrarCobranzaCtaCteSchema`, `ajusteCtaCteSchema` y `autorizadoRetiroId` en ventas.
- [x] Endpoints en `apps/api/src/routes/clientes.ts`:
  - `GET /clientes`: listado con búsqueda y saldos en vivo.
  - `GET /clientes/:id`: ficha del cliente con autorizados a retirar y crédito disponible.
  - `POST /clientes`: alta de cliente con código autogenerado (`CLI-xxx`) o manual.
  - `PUT /clientes/:id`: actualización de datos fiscales, comerciales y límite de crédito.
  - `POST /clientes/:id/autorizados`: alta de personas autorizadas a retirar en mostrador con DNI y rol/parentesco.
  - `GET /clientes/:id/cuenta-corriente`: historial cronológico de movimientos con saldo deudor en vivo.
  - `POST /clientes/:id/cobranzas`: cobro en caja que impacta atómicamente el turno abierto y acredita la cuenta corriente.
  - `POST /clientes/:id/ajustes`: ajustes manuales debidamente auditados.
- [x] Integración en `apps/api/src/routes/caja.ts`: débito automático en cuenta corriente al vender en mostrador con el medio de cobro 'Cuenta Corriente' vinculando `clienteId` y `autorizadoRetiroId`.
- [x] Suite de 5 tests de integración (`apps/api/src/routes/clientes.test.ts`) pasando al 100% contra PostgreSQL 16 real.
- [x] Pantalla web completa `apps/web/src/ClientesCtaCte.tsx`: listado y búsqueda en tiempo real, alta/edición de clientes, ficha de extracto inmutable con débitos/créditos, gestión de personas autorizadas a retirar, cobranza en caja y ajustes manuales auditados.
- [x] Integración en punto de venta / mostrador (`apps/web/src/App.tsx`): pestaña `7. Clientes y Cta. Cte.`, asignación de cliente a la venta, selección de persona autorizada que retira mercadería, validación de límite de crédito y sincronización offline con IndexedDB.
- [x] Tests unitarios y de sincronización offline cubriendo cuenta corriente en mostrador (`apps/web/src/App.test.ts`).

---

## Fase 4 — Compras, Proveedores y Cuentas a Pagar (Completada ✅)

Objetivo: directorio y fichas de proveedores, órdenes de compra, recepción de mercadería con impacto directo en el kardex inmutable de stock (`movimiento_stock`) y actualización del costo base de reposición, libro de cuenta corriente inmutable de proveedores (`movimiento_cta_cte_proveedor`) y pagos imputados en el turno de caja abierto como egresos.

Estado:
- [x] Migración `005_compras_proveedores.sql`: tablas `proveedor`, `producto_proveedor`, `orden_compra`, `item_orden_compra`, tabla inmutable `movimiento_cta_cte_proveedor` con trigger SQL que bloquea `UPDATE` y `DELETE`, vista `v_saldo_proveedor` con cálculo en vivo de compras, pagos y saldo a pagar, RLS activo para `app_user`.
- [x] Esquemas compartidos en `packages/shared`: `guardarProveedorSchema`, `guardarOrdenCompraSchema`, `recibirOrdenCompraSchema`, `registrarPagoProveedorSchema`, `ajusteCtaCteProveedorSchema`.
- [x] Endpoints en `apps/api/src/routes/compras.ts`:
  - `GET /proveedores`: listado con búsqueda y saldos en vivo.
  - `GET /proveedores/:id`: ficha con saldos acumulados de compras y pagos.
  - `POST /proveedores` y `PUT /proveedores/:id`: alta y edición de datos fiscales y plazos de pago.
  - `GET /proveedores/:id/cuenta-corriente`: extracto inmutable con saldos calculados.
  - `POST /proveedores/:id/pagos`: pago a proveedor con impacto atómico en el turno de caja abierto (egreso en efectivo o bancario) y crédito en el libro del proveedor.
  - `POST /proveedores/:id/ajustes`: ajustes manuales debidamente auditados.
  - `GET /compras`: listado de órdenes de compra con estado y proveedor.
  - `POST /compras`: emisión de órdenes de compra con detalle de ítems.
  - `POST /compras/:id/recibir`: recepción de mercadería que inserta movimientos en el kardex inmutable de stock (`ingreso_compra`), actualiza el costo base del producto y, si fue a cuenta corriente, genera el débito en el proveedor.
- [x] Suite de tests de integración (`apps/api/src/routes/compras.test.ts` y `apps/api/src/db/migrate.test.ts`) pasando al 100% contra PostgreSQL 16 real.
- [x] Pantalla web completa `apps/web/src/ComprasProveedores.tsx`:
  - Directorio de proveedores con filtro por deuda pendiente, alta y edición.
  - Ficha de extracto inmutable con débitos por compras y créditos por pagos.
  - Modal de pago imputado directamente en el turno de caja abierto (con selección de medio de cobro).
  - Emisión de órdenes de compra con múltiples ítems, cantidades y costos unitarios.
  - Modal de recepción de mercadería con ingreso a stock y opción de actualización de costo base.
- [x] Integración en el menú principal (`apps/web/src/App.tsx`): pestaña `8. Compras y Proveedores`, refresco automático del saldo en caja ante pagos a proveedores.
- [x] Tests unitarios y de encolado offline de egresos por proveedores (`apps/web/src/App.test.ts`).

---

## Fase 5 — Tesorería y Flujo de Fondos (Completada ✅)

Objetivo: administración integral de cheques físicos y eCheqs (cartera, depósito bancario, endoso a proveedores), liquidación diferida de ventas con tarjeta/QR y cálculo en tiempo real del flujo de caja proyectado a corto y mediano plazo (7, 14, 30 y 60 días).

Estado:
- [x] Migración `006_tesoreria_flujo.sql`:
  - Tabla `cheque_cartera`: multi-tenant con clave compuesta `(id, negocio_id)`, RLS activo para `app_user`, soporte de cheques físicos y eCheqs, seguimiento de estados (`en_cartera`, `depositado`, `entregado_proveedor`, `rechazado`, `anulado`).
  - Vista `v_flujo_caja_proyectado`: consolida ingresos estimados por acreditaciones de tarjetas según `dias_acreditacion` + cheques en cartera según `fecha_pago`, y egresos estimados por facturas de compra según `dias_plazo_pago` del proveedor.
- [x] Esquemas compartidos en `packages/shared`: `guardarChequeSchema`, `depositarChequeSchema`, `endosarChequeProveedorSchema`, `rechazarChequeSchema` y tipo `ItemFlujoCajaProyectado`.
- [x] Endpoints en `apps/api/src/routes/tesoreria.ts`:
  - `GET /tesoreria/cheques`: cartera con filtros por estado y tipo de cheque.
  - `POST /tesoreria/cheques`: recepción e ingreso de valores a la cartera.
  - `POST /tesoreria/cheques/:id/depositar`: depósito en cuenta bancaria.
  - `POST /tesoreria/cheques/:id/endosar-proveedor`: endoso a proveedor con crédito automático en su libro inmutable de cuenta corriente.
  - `POST /tesoreria/cheques/:id/rechazar`: gestión y auditoría de cheques rebotados o rechazados.
  - `GET /tesoreria/flujo-proyectado`: cálculo dinámico del cash flow consolidado con totales de ingresos, egresos y saldo neto a 7, 14, 30 o 60 días.
- [x] Suite de tests de integración (`apps/api/src/routes/tesoreria.test.ts` y `apps/api/src/db/migrate.test.ts`) pasando al 100% contra PostgreSQL 16 real.
- [x] Pantalla web completa `apps/web/src/TesoreriaFlujo.tsx`:
  - Subpestaña de cartera de cheques y eCheqs con filtros por estado/soporte y modales de alta, depósito bancario, endoso a proveedor y rechazo.
  - Subpestaña de flujo de fondos proyectado con selector de horizonte temporal (7, 14, 30, 60 días), métricas consolidadas de ingresos/egresos/saldo neto y cronograma detallado de vencimientos.
- [x] Integración en el menú principal (`apps/web/src/App.tsx`): pestaña `9. Tesorería y Flujo`.

---

## Fase 6 — Facturación Fiscal Electrónica ARCA / AFIP (Completada ✅)

Objetivo: emisión de comprobantes fiscales electrónicos (Facturas A, B, C y Notas de Crédito), puntos de venta oficiales, obtención de CAE y fecha de vencimiento, generación de código QR fiscal oficial (RG 4291/4892), inmutabilidad de comprobantes y modo de contingencia offline.

Estado:
- [x] Migración `007_facturacion_fiscal.sql`:
  - Tabla `punto_venta`: multi-tenant, correlatividad de números oficiales (1 - 99998), datos fiscales del emisor y RLS activo.
  - Tabla inmutable `comprobante_fiscal`: desglose impositivo exacto (`subtotal_neto_gravado`, `iva_21`, `iva_105`, `iva_27`, `exento`), CAE (14 dígitos), vencimiento CAE, código QR ARCA, estado y trigger SQL `tg_comprobante_fiscal_inmutable` que bloquea `UPDATE` y `DELETE` en comprobantes autorizados.
- [x] Esquemas compartidos en `packages/shared`: `tipoComprobanteFiscalSchema`, `guardarPuntoVentaSchema`, `emitirComprobanteFiscalSchema` y `ComprobanteFiscalDetalle`.
- [x] Endpoints en `apps/api/src/routes/facturacion.ts`:
  - `GET /facturacion/puntos-venta` y `POST /facturacion/puntos-venta`: administración de puntos de venta fiscales.
  - `GET /facturacion/comprobantes` y `GET /facturacion/comprobantes/:id`: consulta y detalle de comprobantes emitidos.
  - `POST /facturacion/emitir`: emisión con bloqueo atómico advisory lock para correlatividad estricta sin saltos, cálculo impositivo por alícuotas, simulación de autorización ARCA / AFIP con generación de CAE de 14 dígitos y QR fiscal oficial.
- [x] Suite de tests de integración (`apps/api/src/routes/facturacion.test.ts` y `apps/api/src/db/migrate.test.ts`) pasando al 100% contra PostgreSQL 16 real.
- [x] Pantalla web completa `apps/web/src/FacturacionFiscal.tsx`:
  - Listado de comprobantes emitidos con desglose neto, IVA y total.
  - Modal de emisión de Facturas A y B con validación de CUIT, selección de alícuota y opción de contingencia offline.
  - Modal de detalle fiscal con CAE, vencimiento, QR oficial ARCA y botón de impresión de ticket/factura.
  - Administración de puntos de venta fiscales.
- [x] Integración en el menú principal (`apps/web/src/App.tsx`): pestaña `10. Facturación ARCA`.

---

---

## Fase 7 — Contabilidad y Partida Doble (Completada ✅)

Objetivo: plan de cuentas jerárquico, registro cronológico e inmutable de asientos en el libro diario con partida doble estricta (`Total Debe === Total Haber`), balance de comprobación de sumas y saldos en vivo, y aislamiento multi-tenant con RLS.

Estado:
- [x] Migración `008_contabilidad.sql`:
  - Tabla `cuenta_contable`: plan de cuentas (Activo, Pasivo, Patrimonio Neto, Ingreso, Egreso) con clave compuesta `(id, negocio_id)`, índices y RLS activo.
  - Tabla inmutable `asiento_contable`: número correlativo por negocio, fecha, concepto, origen (`venta`, `egreso_caja`, `cobro_cta_cte`, `compra_stock`, `pago_proveedor`, `deposito_cheque`, `ajuste`, `manual`) y trigger SQL `tg_asiento_contable_inmutable` que prohíbe `UPDATE` y `DELETE`.
  - Tabla inmutable `renglon_asiento`: débitos y créditos con `numeric(14,2)`, comprobación de no negatividad, trigger `tg_renglon_asiento_inmutable` y RLS activo.
  - Vistas oficiales: `v_libro_diario` (asientos y renglones agrupados con cuentas) y `v_sumas_y_saldos` (débitos, créditos, saldos deudores y acreedores calculados en tiempo real).
- [x] Esquemas compartidos en `packages/shared`: `tipoCuentaContableSchema`, `guardarCuentaContableSchema`, `renglonAsientoInputSchema`, `crearAsientoManualSchema`, `CuentaContableItem`, `AsientoContableDetalle` e `ItemSumasYSaldos`.
- [x] Endpoints en `apps/api/src/routes/contabilidad.ts`:
  - `GET /contabilidad/cuentas`: obtiene el plan de cuentas con auto-siembra de cuentas estándar de ferretería si está vacío.
  - `POST /contabilidad/cuentas`: alta de cuentas contables imputables.
  - `GET /contabilidad/libro-diario`: libro diario cronológico con filtros de origen y fechas, renglones agrupados y validación de partida cuadrada.
  - `GET /contabilidad/sumas-y-saldos`: balance de comprobación de sumas y saldos con saldos deudores y acreedores.
  - `POST /contabilidad/asientos`: registro de asiento manual con validación estricta de partida doble (`Σ Debe === Σ Haber > 0`) y bloqueo advisory lock para correlatividad sin huecos.
- [x] Suite de tests de integración (`apps/api/src/routes/contabilidad.test.ts` y `apps/api/src/db/migrate.test.ts`) pasando al 100% (61 tests en total) contra PostgreSQL 16 real.
- [x] Pantalla web completa `apps/web/src/Contabilidad.tsx`:
  - Subpestaña 1: Libro Diario General con filtros de origen y fechas, visualización de asientos con renglones, totales y badge de partida cuadrada.
  - Subpestaña 2: Balance de Sumas y Saldos con totales consolidados y verificación visual de equilibrio contable.
  - Subpestaña 3: Plan de cuentas con alta de nuevas cuentas contables.
  - Modal para registro de asientos manuales con renglones dinámicos y validador en tiempo real de partida doble (`Total Debe === Total Haber`).
- [x] Integración en el menú principal (`apps/web/src/App.tsx`): pestaña `11. Contabilidad`.

---

## Fase 8 — Presupuestos y Cotizaciones de Mostrador (Completada ✅)

Objetivo: confección ágil de presupuestos para clientes y gremios de la construcción con validez temporal de precios, selección de listas con márgenes, impresión formal y conversión directa a venta en el carrito de mostrador en un solo clic.

Estado:
- [x] Migración `009_presupuestos.sql`:
  - Tabla `presupuesto`: número correlativo por negocio, fecha de emisión, fecha de vencimiento (`dias_validez`), cliente/contacto, lista de precios, totales, observaciones, estado (`pendiente`, `aprobado_convertido`, `vencido`, `cancelado`), venta_id asociado y RLS activo para `app_user`.
  - Tabla `item_presupuesto`: producto_id opcional, código, nombre, unidad, cantidad (`numeric(14,3)`), precio unitario (`numeric(14,2)`), descuento porcentual, subtotal y clave foránea en cascada.
- [x] Esquemas compartidos en `packages/shared`: `estadoPresupuestoSchema`, `guardarItemPresupuestoSchema`, `guardarPresupuestoSchema`, `ItemPresupuestoDetalle` y `PresupuestoDetalle`.
- [x] Endpoints en `apps/api/src/routes/presupuestos.ts`:
  - `GET /presupuestos`: listado con filtros por estado o búsqueda, con cálculo dinámico de vencimiento según la fecha actual.
  - `GET /presupuestos/:id`: detalle completo del presupuesto con sus ítems cotizados.
  - `POST /presupuestos`: emisión con bloqueo advisory lock por tenant para números consecutivos sin saltos.
  - `POST /presupuestos/:id/marcar-convertido`: marca como `aprobado_convertido` vinculando el id de la venta efectuada.
  - `POST /presupuestos/:id/cancelar`: cancelación de presupuestos.
- [x] Suite de tests de integración (`apps/api/src/routes/presupuestos.test.ts` y `apps/api/src/db/migrate.test.ts`) pasando al 100% (66 tests en total) contra PostgreSQL 16 real.
- [x] Pantalla web completa `apps/web/src/Presupuestos.tsx`:
  - Directorio de presupuestos con buscador por cliente/obra y selector de estado.
  - Modal de confección de presupuesto con buscador en vivo de artículos de catálogo, cálculo automático de precio según lista elegida, ítems libres y cálculo de totales en centavos.
  - Modal de detalle con opción de impresión directa y botón de **"Cargar en Carrito y Vender 🛒"** que transfiere instantáneamente los materiales al mostrador de caja para facturar.
- [x] Integración en el menú principal (`apps/web/src/App.tsx`): pestaña `12. Presupuestos`.

---

## Fase 9 — Impresión Térmica ESC/POS (58mm/80mm) y Exportación a Excel/CSV (Completada ✅)

Objetivo: dotar a todas las operaciones de mostrador y administración de comanderas térmicas de 58mm y 80mm para impresión de tickets no fiscales y comprobantes rápidos, y exportación masiva universal a planillas de cálculo (Excel / Google Sheets) con codificación UTF-8 con BOM y separador regional.

Estado:
- [x] Utilidad universal de tickets térmicos (`apps/web/src/utils/impresion-ticket.ts`):
  - Formateo de tickets adaptados para comanderas térmicas de 58mm y 80mm.
  - Reglas CSS `@page { size: 58mm/80mm auto; margin: 0; }` y fuentes monospace legibles.
  - Encabezado con datos del comercio, número de comprobante, cajero, caja, cliente, tabla de ítems con cantidades, precios unitarios, subtotales, medios de pago y pie de control de garantía.
  - Apertura en ventana emergente con disparo automático de `window.print()` y auto-cierre.
- [x] Utilidad universal de exportación CSV/Excel (`apps/web/src/utils/exportar-csv.ts`):
  - Soporte de caracteres en español (acentos, ñ, signos de pesos) mediante prefijo UTF-8 BOM (`\uFEFF`).
  - Separador punto y coma (`;`) para apertura directa y nativa sin configuración en Microsoft Excel para Argentina / Latinoamérica y Google Sheets.
  - Escape automático de comillas dobles y saltos de línea.
- [x] Botones de exportación e impresión en pantallas clave:
  - **Mostrador de Ventas (`App.tsx`)**: Banner tras cada venta para imprimir ticket térmico en 80mm o 58mm de inmediato; botón para exportar a Excel el resumen de ventas del turno actual.
  - **Historial y Reportes (`ReportesHistorial.tsx`)**: Botones para exportar reporte de caja del día y el historial de turnos con arqueos a Excel.
  - **Contabilidad (`Contabilidad.tsx`)**: Botones para exportar el Libro Diario completo y el Balance de Sumas y Saldos a Excel.
  - **Facturación Fiscal (`FacturacionFiscal.tsx`)**: Botón para exportar el Libro IVA Ventas oficial a Excel.
  - **Presupuestos (`Presupuestos.tsx`)**: Botón para exportar la lista de cotizaciones a Excel.
- [x] Verificación completa: `pnpm typecheck`, `pnpm lint`, `pnpm test` (66 tests pasando) y `pnpm build` aprobados con cero errores.

---

## Fase 10 — Automatización de Asientos Contables por Eventos del Negocio (Completada ✅)

Objetivo: generación atómica e inmutable de asientos en el libro diario de partida doble (`Σ Debe === Σ Haber`) disparados automáticamente en tiempo real por cada operación comercial, eliminando la carga manual y manteniendo el balance de sumas y saldos permanentemente actualizado.

Estado:
- [x] Servicio centralizado de contabilidad (`apps/api/src/services/contabilidad-service.ts`):
  - Helper `registrarAsientoAutomatico(client, params)` con validación de partida doble balanceada en centavos enteros (`Σ Debe === Σ Haber > 0`).
  - Auto-siembra e inicialización garantizada de cuentas contables estándar de ferretería (`PLAN_CUENTAS_BASE`) en la primera operación del negocio.
  - Bloqueo transaccional `pg_advisory_xact_lock(hashtext('asiento_contable_' || negocioId))` para numeración correlativa estricta y sin saltos.
- [x] Eventos de negocio integrados en tiempo real:
  - **Ventas de mostrador (`apps/api/src/routes/caja.ts`)**: Débito a *Caja Efectivo* (`1.1.01`), *Banco y Cuentas Virtuales* (`1.1.02`), *Deudores por Ventas / Cta Cte* (`1.1.04`) o *Valores a Depositar* (`1.1.03`) y Crédito a *Ventas de Mercadería* (`4.1.01`).
  - **Egresos y retiros de caja (`apps/api/src/routes/caja.ts`)**: Débito a *Gastos Generales y Operativos* (`5.1.02`) o *Banco* (`1.1.02`) y Crédito a *Caja Efectivo* (`1.1.01`).
  - **Cobranzas de cuentas corrientes (`apps/api/src/routes/clientes.ts`)**: Débito a *Caja* o *Banco* y Crédito a *Deudores por Ventas (Cta Cte)* (`1.1.04`).
  - **Recepción de compras y mercaderías (`apps/api/src/routes/compras.ts`)**: Débito a *Mercaderías en Stock* (`1.1.05`) y Crédito a *Proveedores (Cta Cte)* (`2.1.01`).
  - **Pagos a proveedores (`apps/api/src/routes/compras.ts`)**: Débito a *Proveedores (Cta Cte)* (`2.1.01`) y Crédito a *Caja* o *Banco*.
  - **Depósito y endoso de cheques (`apps/api/src/routes/tesoreria.ts`)**: Débito a *Bancos* o *Proveedores* y Crédito a *Valores a Depositar (Cheques)* (`1.1.03`).
- [x] Pruebas automáticas y calidad:
  - Nuevo test automatizado en `apps/api/src/routes/contabilidad.test.ts` (test 8) que comprueba la creación automática de asientos al vender y egresar de caja, y su impacto directo en el Balance de Sumas y Saldos.
  - Suite de pruebas de Vitest pasando al 100% (13 archivos de prueba, 67 tests pasando en PostgreSQL real con Testcontainers).
  - `pnpm typecheck`, `pnpm lint` y `pnpm build` aprobados con cero errores.

---

## Mejora UX/UI — Tablero de Inicio Principal y Menús Agrupados por Áreas (Completada ✅)

Objetivo: optimizar la experiencia de usuario en mostrador y administración reemplazando la cuadrícula plana y desordenada de 12 pestañas por un Sidebar profesional organizado por áreas funcionales, un Header superior limpio con badge de turno y una nueva Pantalla de Inicio / Tablero de Control con métricas en vivo y accesos directos táctiles.

Estado:
- [x] Pantalla de Inicio / Dashboard Principal (`apps/web/src/InicioDashboard.tsx`):
  - Banner de bienvenida con estado de caja en tiempo real (abierta/cerrada), fecha y rol activo.
  - Tarjetas de KPIs en vivo: Efectivo inicial, Ventas acumuladas del turno, Egresos registrados y Efectivo esperado en cajón.
  - Accesos rápidos táctiles en un toque a las operaciones cotidianas: Venta en Mostrador, Presupuestos, Artículos y Stock, Egresos, Clientes y Cta. Cte., Proveedores, Facturación Fiscal y Cierre con Arqueo.
  - Paneles de control: ventas del turno desglosadas por medio de cobro, estado de conectividad, contador de cola offline y resultado del último arqueo cerrado.
- [x] Reestructuración del Menú de Navegación (`apps/web/src/App.tsx`):
  - **Sidebar Lateral Categorizado**:
    - **General**: Inicio / Tablero (`tab-inicio`).
    - **Mostrador & Caja**: Venta en Mostrador (`tab-venta`), Presupuestos (`tab-presupuestos`), Egresos (`tab-egreso`), Arqueo (`tab-arqueo`).
    - **Stock & Clientes**: Artículos y Stock (`tab-catalogo`), Clientes & Cta. Cte. (`tab-clientes`), Compras & Proveedores (`tab-compras`).
    - **Finanzas & Fiscal**: Tesorería (`tab-tesoreria`), Facturación ARCA (`tab-facturacion`), Contabilidad (`tab-contabilidad`).
    - **Control & Sistema**: Reportes (`tab-reportes`), Configuración (`tab-configuracion`).
  - **Header Superior Limpio**: Selector de operador, botón toggle de conexión online/offline con indicador de cola y badge vivo de efectivo esperado en cajón.
  - **Barra de Navegación Inferior (Bottom Nav)**: Para celulares y tabletas PWA con accesos rápidos a Inicio, Vender, Cotizar, Stock y Menú lateral.
- [x] Compatibilidad total con tests existentes: todos los `data-testid` se mantuvieron intactos.

---

## Fase 11 — Auditoría Centralizada y Cierre de Ejercicio Contable (Completada ✅)

Objetivo: dotar al sistema de trazabilidad rigurosa e inmutable de todas las acciones sensibles (anulaciones de ventas, arqueos con diferencias, ajustes de cuenta corriente, cambios de precio, aperturas y cierres contables), junto con un asistente formal de Cierre de Ejercicio Económico con asientos automáticos de refundición de pérdidas y ganancias y cierre patrimonial.

Estado:
- [x] Migración `010_auditoria_cierre_ejercicio.sql`:
  - Tabla inmutable `registro_auditoria`: multi-tenant con clave compuesta `(id, negocio_id)`, datos del operador, acción, entidad, entidad_id, detalles JSONB y trigger SQL `tg_registro_auditoria_inmutable` que prohíbe `UPDATE` y `DELETE`.
  - Tabla `ejercicio_contable`: períodos contables numerados correlativamente con bloqueo advisory lock por tenant, fechas `fecha_inicio` y `fecha_fin`, estado (`abierto`, `cerrado`), vínculos a asientos de refundición y cierre patrimonial.
  - Trigger SQL `tg_asiento_contable_ejercicio_abierto`: bloquea preventivamente a nivel de base de datos la inserción de cualquier asiento contable cuya fecha pertenezca a un ejercicio contable cerrado.
  - RLS activo para aislar estrictamente por negocio.
- [x] Esquemas compartidos en `packages/shared`:
  - `accionAuditoriaSchema`, `entidadAuditoriaSchema`, `filtroAuditoriaSchema` y tipo `RegistroAuditoriaItem`.
  - `crearEjercicioContableSchema`, `cerrarEjercicioContableSchema`, `estadoEjercicioSchema` y tipo `EjercicioContableItem`.
  - Ampliación de `origenAsientoSchema` incorporando `'cierre_ejercicio'` y `'refundicion_resultados'`.
- [x] Servicio de auditoría y endpoints en API (`apps/api`):
  - Helper centralizado `registrarAuditoria(...)` (`apps/api/src/services/auditoria-service.ts`) transaccional y consistente.
  - Endpoint `GET /auditoria` con filtros por acción, entidad, fechas y operador, restringido estrictamente a roles `encargado` y `dueno`.
  - Endpoints contables: `GET /contabilidad/ejercicios`, `POST /contabilidad/ejercicios` (apertura) y `POST /contabilidad/ejercicios/:id/cerrar` (asiento automático de refundición de cuentas de resultado contra *3.2.01 Resultado del Ejercicio* y asiento de cierre patrimonial).
  - Trazabilidad automática integrada en: reversión/anulación de ventas (`caja.ts`), arqueos y cierres de turno (`caja.ts`), ajustes de clientes (`clientes.ts`), ajustes de proveedores (`compras.ts`) y asientos manuales (`contabilidad.ts`).
- [x] Suite de tests de integración (`apps/api/src/routes/auditoria-cierre.test.ts`):
  - 6 pruebas de integración pasando al 100% en PostgreSQL 16 real con Testcontainers (inmutabilidad por triggers, permisos por rol, trazabilidad de arqueos con diferencias, refundición contable exacta y bloqueo de períodos cerrados, aislamiento multi-tenant).
- [x] Interfaz Web (`apps/web`):
  - Nueva pantalla **Auditoría del Sistema** (`apps/web/src/AuditoriaSistema.tsx`): visor cronológico, filtros por tipo de acción y fechas, badge temático, visualizador modal de JSON de transacción y botón para **Exportar a Excel / CSV** con UTF-8 BOM.
  - Subpestaña **"4. Ejercicios & Cierre"** en Contabilidad (`apps/web/src/Contabilidad.tsx`): directorio de ejercicios fiscales, modal para apertura de nuevo período y asistente de cierre de ejercicio con confirmación formal y resumen del resultado neto refundido.
  - Integración en el menú principal (`apps/web/src/App.tsx`): pestaña `🛡️ Auditoría del Sistema` en la sección "Control & Sistema".
- [x] Verificación de calidad: `pnpm typecheck`, `pnpm lint`, `pnpm build` y suite completa de tests de Vitest (14 archivos, 73 tests pasando al 100% contra PostgreSQL real).

---

## Fase 12 — Facturación Automática en Mostrador (ARCA / AFIP) y Detalle de Ítems (Completada ✅)

Objetivo: permitir que desde el cobro de una venta en mostrador se pueda emitir opcionalmente la Factura Electrónica oficial de ARCA/AFIP (Factura A o B/C según la condición de IVA del cliente), vinculada a la venta y persistiendo el desglose completo de ítems (cantidades, precios unitarios, IVA, subtotales), con generación de CAE, código QR oficial y plantillas de impresión profesional A4 y térmica comanderas (80mm / 58mm).

Estado:
- [x] Migración `011_items_factura_y_venta.sql`:
  - Tabla inmutable `item_comprobante_fiscal`: multi-tenant con clave compuesta `(id, negocio_id)`, FK a `comprobante_fiscal(id, negocio_id)` con `on delete cascade`, `producto_id`, `codigo`, `descripcion`, `unidad`, `cantidad numeric(14,3)`, `precio_unitario numeric(14,2)`, `alicuota_iva text`, `subtotal numeric(14,2)`.
  - RLS activado con política `item_comprobante_fiscal_tenant_isolation` (`negocio_id = current_setting('app.negocio_id', true)::uuid`).
  - Permisos otorgados a `app_user` (`grant select, insert on item_comprobante_fiscal to app_user`).
  - Índices sobre `(negocio_id, comprobante_id)` y `(negocio_id, producto_id)`.
- [x] Esquemas compartidos en `packages/shared`:
  - `itemComprobanteFiscalInputSchema`, `ItemComprobanteFiscalInput`, `ItemComprobanteFiscalDetalle`.
  - Actualización de `emitirComprobanteFiscalSchema` para recibir opcionalmente `items?: ItemComprobanteFiscalInput[]`.
  - Actualización de `ComprobanteFiscalDetalle` con campo `items?: ItemComprobanteFiscalDetalle[]`.
- [x] Backend API (`apps/api/src/routes/facturacion.ts`):
  - Inserción atómica dentro de la transacción de los renglones en `item_comprobante_fiscal` al llamar a `POST /facturacion/emitir`.
  - Endpoint `GET /facturacion/comprobantes/:id`: consulta y mapea el detalle completo de ítems asociados al comprobante.
  - Test de integración añadido en `apps/api/src/routes/facturacion.test.ts` (test 6: comprobación de persistencia y lectura de ítems).
- [x] Módulo de impresión de Facturas Oficiales (`apps/web/src/utils/impresion-factura.ts`):
  - Formato formal A4 y térmica comandera 80mm con letra identificadora ("A", "B", "C"), código AFIP (01, 06, 11), punto de venta y número correlativo, datos del emisor y receptor (CUIT, Ingresos Brutos, Condición IVA), tabla de productos con discriminación impositiva, CAE, Vto. CAE y Código QR oficial de ARCA.
  - Mejora en `apps/web/src/utils/impresion-ticket.ts`: soporte para `logoUrl` y estética limpia.
- [x] Integración en mostrador (`apps/web/src/App.tsx`):
  - Switch interactivo en la zona de cobro: `[✓] Emitir Factura Electrónica ARCA`, con detección automática de Factura A (para Responsables Inscriptos) o Factura B (para Consumidores Finales).
  - Al cobrar, si la opción está activa, se registra la venta y se emite automáticamente el comprobante oficial con CAE e ítems del carrito.
  - Banner dinámico tras el cobro: botones para `Factura Oficial (A4)`, `Factura Ticket (80mm)`, `Ticket Térmico (80mm/58mm)` y `✕ Cerrar`.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los paquetes.
  - `pnpm lint` con cero errores.
  - Suite completa de 74 tests pasando en PostgreSQL real con Testcontainers (`pnpm test`).
  - `pnpm build` de Vite completado exitosamente.

---

## Fase 13 — Autenticación Directa, Sesión y Pantalla de Login (Completada ✅)

Objetivo: dotar al sistema de una pantalla formal de inicio de sesión con usuario/email y contraseña criptográfica, protegiendo las operaciones comerciales de acuerdo a los roles de acceso (`cajero`, `encargado`, `dueno`), persistencia de sesión local y botón de salida/cierre de sesión seguro.

Estado:
- [x] Migración SQL `012_usuarios_autenticacion.sql`:
  - Nuevas columnas en tabla `usuario`: `email text`, `password_hash text`, `ultimo_ingreso timestamptz`.
  - Índices sobre `lower(email)` y `lower(nombre)`.
  - Función de base de datos `autenticar_usuario(p_identificador, p_negocio_id)` con `security definer` para verificación previa a la apertura de transacción con RLS.
  - Actualización de usuarios de demostración iniciales con credenciales seguras salteadas (`demo-cajero`, `demo-encargado`, `demo-dueno`).
- [x] Esquemas compartidos en `packages/shared`:
  - `loginInputSchema`, `UsuarioSesion`, `LoginResponse`.
- [x] Backend API (`apps/api`):
  - Utilidad criptográfica `apps/api/src/services/password.ts` con sal aleatoria de 16 bytes y scrypt (`timingSafeEqual` contra timing attacks).
  - Rutas de autenticación en `apps/api/src/routes/auth.ts`: `POST /auth/login` (emisión de JWT con claims de tenant), `GET /auth/me` (perfil activo) y `POST /auth/logout`.
  - Suite de 6 tests de integración en `apps/api/src/routes/auth.test.ts` pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Componente de pantalla `apps/web/src/Login.tsx`: interfaz responsiva con branding de ferretería, inputs validados, toggle de visibilidad de contraseña y chips de acceso rápido de 1 clic para desarrollo/piloto.
  - Integración en `apps/web/src/App.tsx`: bloqueo de acceso si no hay sesión, persistencia en `localStorage`, indicador de usuario y rol autenticado en el header y botón de salida **"Salir 🚪"** (`btn-cerrar-sesion`).
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores.
  - `pnpm lint` superado con cero errores.
  - Suite completa de **80 tests pasando al 100%** (`pnpm test`).
  - Compilación de producción con Vite (`pnpm build`) exitosa.

---

## Fase 14 — Carga Masiva desde Excel / CSV de Artículos y Precios (Completada ✅)

Objetivo: permitir a los encargados y dueños cargar o actualizar masivamente el catálogo de artículos de la ferretería a partir de archivos de Excel / CSV o pegando celdas directamente desde el portapapeles, actualizando precios de costo y venta, resolviendo rubros automáticamente y conciliando existencias de stock en el libro inmutable de Kardex (`movimiento_stock`).

Estado:
- [x] Esquemas compartidos en `packages/shared`:
  - `itemImportacionProductoSchema`, `importarProductosMasivoSchema`, `ItemImportacionProducto`, `ImportarProductosMasivoInput`, `ResultadoImportacionMasiva`.
- [x] Backend API (`apps/api/src/routes/productos.ts`):
  - Endpoint `POST /productos/importar-masivo` con control de roles (`encargado`, `dueno`).
  - Resolución y siembra automática de rubros inexistentes con `on conflict (negocio_id, nombre) do update`.
  - Inserción y actualización atómica en tabla `producto` (`on conflict (negocio_id, codigo) do update`).
  - Deducción automática de costo base cuando se proporciona precio de venta mostrador sin costo.
  - Asociación de códigos de barra / EAN en `producto_codigo_barra`.
  - Conciliación de stock físico en el libro inmutable `movimiento_stock`: calcula la diferencia contra `v_stock_actual` y registra movimientos de auditoría (`ajuste_sobrante` o `ajuste_faltante`) respetando la regla 1 de AGENTS.md.
  - Registro de auditoría centralizada inmutable en `registro_auditoria` (`cambio_precio` sobre `articulo`).
  - Tests de integración añadidos en `apps/api/src/routes/productos.test.ts` (11 tests pasando).
- [x] Frontend Web (`apps/web`):
  - Componente modal `apps/web/src/ImportadorMasivoModal.tsx`:
    - Descarga de plantilla modelo `.csv` compatible con Excel con un solo clic.
    - Soporte dual de carga: subida de archivo `.csv` / `.txt` o pegado directo de celdas desde Excel (Ctrl+V).
    - Parseador inteligente tolerante a coma, punto y coma o tabulación, normalizador numérico de moneda y cantidades.
    - Tabla de previsualización con semáforo interactivo (verde para altas nuevas, azul para actualizaciones de precio/stock, rojo para errores de formato).
    - Botón de confirmación e importación masiva con reporte de resultados en tiempo real.
  - Integración en `apps/web/src/CatalogoStock.tsx` con botón `[📥 Carga Masiva (Excel/CSV)]`.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero errores.
  - Suite completa de **83 tests pasando al 100%** en PostgreSQL real con Testcontainers (`pnpm test`).
  - Build de producción con Vite (`pnpm build`) exitoso.













---

## Fase 15 — Configuración Integral de Empresa, Branding, Gestión de Usuarios y Matriz de Roles (Completada ✅)

Objetivo: dotar al sistema de una administración corporativa integral que permita configurar los datos comerciales y fiscales de la ferretería (Razón Social, CUIT, Condición de IVA, Ingresos Brutos, Inicio de Actividades, Domicilio Comercial, Teléfono, Email), branding con cargador de logo y leyenda de tickets con previsualización en vivo, junto a una gestión segura de usuarios (altas, bajas lógicas, asignación de roles y restablecimiento de contraseñas con hasheo criptográfico) y una matriz transparente de permisos.

Estado:
- [x] Migración SQL `db/migrations/014_configuracion_empresa.sql`:
  - Ampliación de la tabla `negocio` con columnas comerciales, fiscales y de branding (`razon_social`, `cuit`, `condicion_iva`, `iibb`, `inicio_actividades`, `domicilio_comercial`, `telefono`, `email`, `logo_url`, `leyenda_ticket`).
  - Activación y forzado de Row Level Security (RLS) en `negocio` con políticas diferenciadas para `SELECT`, `UPDATE` (aislado por `id = app.negocio_id`), `INSERT` y bloqueo estricto de `DELETE`.
  - Concesión de privilegios `SELECT, INSERT, UPDATE` en `negocio` y `INSERT` en `usuario` para el rol de aplicación `app_user`.
  - Sembrado de datos comerciales y leyenda de tickets para el negocio demo.
- [x] Esquemas compartidos en `packages/shared`:
  - `guardarDatosEmpresaSchema`, `GuardarDatosEmpresaInput`, `DatosEmpresaItem`.
  - `guardarUsuarioAdminSchema`, `GuardarUsuarioAdminInput`, `UsuarioItemAdmin`.
  - `cambiarPasswordAdminSchema`, `CambiarPasswordAdminInput`.
- [x] Backend API (`apps/api/src/routes/configuracion.ts`):
  - `GET /configuracion/empresa`: lectura protegida de datos comerciales del negocio del token.
  - `PUT /configuracion/empresa`: actualización atómica de datos comerciales y leyenda de tickets (rol exclusivo `dueno`).
  - `GET /configuracion/usuarios`: listado de personal del negocio (roles `encargado`, `dueno`).
  - `POST /configuracion/usuarios`: alta de usuario con hasheo criptográfico scrypt (`hashPassword`), control de unicidad de email por negocio y aislamiento tenant.
  - `PUT /configuracion/usuarios/:id`: modificación de datos de personal y estado activo/inactivo (con protección contra auto-desactivación del propio dueño).
  - `POST /configuracion/usuarios/:id/password`: restablecimiento directo de contraseña por el dueño.
  - Actualización de `apps/api/src/db/migrate.test.ts` y 2 nuevos tests de integración en `apps/api/src/routes/configuracion.test.ts` pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Rediseño de `apps/web/src/ConfiguracionPiloto.tsx` en 5 pestañas organizadas:
    1. 🏢 **Empresa & Branding**: formulario comercial completo, cargador dual de logo (URL o archivo de imagen local convertido a base64) y previsualizador en vivo con estilo de papel térmico.
    2. 👥 **Gestión de Usuarios**: listado con chips de rol y estado, botón `+ Nuevo Usuario`, modales de edición y restablecimiento de contraseña.
    3. 🛡️ **Matriz de Roles**: tabla comparativa de segregación de funciones entre Cajero, Encargado y Dueño.
    4. 💳 **Medios de Pago & Catálogos**: medios de cobro con días de acreditación para flujo de caja proyectado, comisiones, rubros y categorías.
    5. 📊 **Bitácora Piloto**: monitoreo de salud API/RLS y conciliación diaria contra planilla/cuaderno.
  - Soporte de `leyendaTicket` personalizado en `apps/web/src/utils/impresion-ticket.ts`.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero errores.
  - Suite completa de **85 tests pasando al 100%** (`pnpm test`).
  - Compilación de producción (`pnpm build`) exitosa.

---

## Fase 16 — Control de Inventario Físico, Recuentos Ciegos y Conciliación en Kardex (Completada ✅)

Objetivo: proveer una solución integral y profesional de auditoría de existencias físicas para la ferretería que permita realizar tomas de inventario generales o por rubro, habilitar recuentos ciegos (sin que el operador vea las cantidades del sistema) para evitar sesgos, detectar diferencias cuantitativas y monetarias en tiempo real con semáforo visual, y conciliar el stock en un solo clic impactando de forma inmutable en el Kardex (`movimiento_stock`) con asientos contables automáticos por variación patrimonial (mermas o sobrantes).

Estado:
- [x] Migración SQL `db/migrations/015_inventario_fisico.sql`:
  - Creación de tabla `inventario_fisico`: identificador, número secuencial por negocio, nombre/motivo, alcance (`general` o `rubro`), `rubro_id`, estado (`borrador`, `en_progreso`, `conciliado`, `cancelado`), modo de conteo (`ciego` o `revelado`), fechas de apertura y cierre, usuario responsable y totales valorizados de faltantes y sobrantes.
  - Creación de tabla `item_inventario_fisico`: snapshot de `stock_sistema` a la fecha de inicio, `stock_contado`, `diferencia`, costo unitario ponderado, diferencia valorizada, timestamp de conteo y operario que realizó el conteo.
  - Claves foráneas compuestas `(id, negocio_id)` y `(producto_id, negocio_id)`.
  - Activación y forzado estricto de Row Level Security (RLS) en ambas tablas.
  - Concesión de privilegios `SELECT, INSERT, UPDATE` al rol de aplicación `app_user`.
- [x] Esquemas compartidos en `packages/shared`:
  - `iniciarInventarioSchema`, `itemConteoInputSchema`, `guardarConteosInventarioSchema`, `aplicarInventarioSchema`.
  - Tipos TypeScript compartidos: `InventarioFisicoItem`, `ItemInventarioDetalle`, `DetalleInventarioFisico`.
- [x] Backend API (`apps/api/src/routes/inventario.ts`):
  - `GET /inventarios`: historial ordenado de inventarios físicos con contadores de ítems y estado.
  - `POST /inventarios/iniciar`: snapshot atómico de stock del sistema actual para todos los artículos activos (o filtrados por rubro) con costo de reposición.
  - `GET /inventarios/:id`: detalle completo del inventario con sus ítems, diferencias calculadas y datos del producto.
  - `PUT /inventarios/:id/conteos`: guardado progresivo de recuentos físicos por lote con recálculo en vivo de diferencias.
  - `POST /inventarios/:id/aplicar`: conciliación atómica y definitiva:
    - Genera movimientos inmutables de Kardex en `movimiento_stock` con tipos `ajuste_sobrante` (in) o `ajuste_faltante` (out).
    - Asiento contable automático con `registrarAsientoAutomatico` reflejando la pérdida neta (Débito a Mermas / Crédito a Mercaderías) o ganancia neta (Débito a Mercaderías / Crédito a Otros Ingresos).
    - Transición de estado a `conciliado` con sellado de totales.
  - `POST /inventarios/:id/cancelar`: anulación de inventarios en borrador sin impacto en Kardex.
  - Integración en `apps/api/src/server.ts` bajo rutas duales (`/api/inventarios` y `/inventarios`) y soporte SPA.
  - Actualización de `apps/api/src/db/migrate.test.ts`.
  - Suite de integración exhaustiva en `apps/api/src/routes/inventario.test.ts` con 5 tests pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Componente completo `apps/web/src/InventarioFisico.tsx`:
    - Tablero con directorio de inventarios y filtros por estado.
    - Modal para iniciar nuevo inventario (alcance general o por rubro, modo ciego vs revelado).
    - Modo recuento ciego donde el conteo del sistema permanece oculto para máxima rigurosidad en pasillo/góndola.
    - Captura rápida de conteos físicos por teclado, con guardado automático.
    - Semáforo visual de diferencias: verde (coincidencia exacta), rojo (faltante / pérdida), azul (sobrante).
    - Métricas valorizadas en vivo: unidades faltantes, unidades sobrantes, impacto monetario neto y costo total auditado.
    - Botón de conciliación definitiva con modal de confirmación y advertencia de impacto irreversible en Kardex.
    - Exportación a planilla Excel / CSV con encabezados estructurados y BOM UTF-8.
  - Integración en la navegación lateral de `apps/web/src/App.tsx` en el bloque *Stock & Clientes*.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero advertencias ni errores.
  - Suite completa de tests de integración en PostgreSQL real superada.
  - Compilación de producción (`pnpm build`) exitosa.

---

## Fase 17A — Listas de Precios Múltiples y Reglas de Descuento por Volumen (Completada ✅)

Objetivo: dotar a la ferretería de una política de comercialización dinámica y flexible que permita crear listas de precios múltiples (Mostrador, Gremio, Mayorista, Distribuidor, Obras), sobreescribir precios fijos excepcionales por producto en listas específicas (sin depender exclusivamente del margen porcentual sobre el costo base) y configurar reglas de descuento y bonificación automáticas por cantidad/volumen (por artículo o rubro completo), recalculando precios y subtotales en tiempo real en caja y presupuestos.

Estado:
- [x] Migración SQL `db/migrations/016_listas_precios_y_descuentos_volumen.sql`:
  - Creación de tabla `regla_descuento_volumen`: identificador, nombre de promoción, `producto_id`, `rubro_id`, `lista_precio_id`, `cantidad_minima`, `descuento_pct`, `activo`, `creado_en`.
  - Creación de tabla `precio_producto_lista`: asignación manual de precio fijo por producto y lista de precios, con timestamp de actualización.
  - Actualización de la vista `v_precios_producto`: resuelve con `coalesce(ppl.precio_fijo, round(p.costo_base * (1 + lp.margen_pct / 100), 2))` e informa `es_precio_fijo`.
  - Índices de rendimiento, claves foráneas compuestas con `negocio_id` y aislamiento estricto por Row Level Security (RLS).
  - Privilegios concedidos al rol de aplicación `app_user`.
- [x] Esquemas compartidos en `packages/shared`:
  - `crearListaPrecioSchema`, `fijarPrecioProductoListaSchema`, `crearReglaVolumenSchema`, `actualizarReglaVolumenSchema`.
  - Tipos TypeScript compartidos: `ReglaDescuentoVolumenItem`, `PrecioProductoListaItem`.
  - Función de utilidad matemática pura `evaluarDescuentoVolumen(params)` con tests unitarios pasando al 100%.
- [x] Backend API (`apps/api/src/routes/precios-reglas.ts`):
  - `POST /listas-precios`: creación de nuevas listas de precios con validación de rol `dueno` y nombres únicos por negocio.
  - `DELETE /listas-precios/:id`: baja de lista (con protección contra borrado de la lista base 'Mostrador').
  - `POST /listas-precios/fijar-precio`: sobreescritura de precio fijo excepcional por producto.
  - `DELETE /listas-precios/fijar-precio/:productoId/:listaPrecioId`: restablecimiento de precio dinámico por margen.
  - `GET /reglas-volumen`: listado de reglas del negocio con nombres de producto y rubro asociados.
  - `POST /reglas-volumen`: alta de regla por producto o rubro.
  - `PUT /reglas-volumen/:id`: modificación, pausa o reactivación.
  - `DELETE /reglas-volumen/:id`: eliminación de regla.
  - Integración en `apps/api/src/server.ts` con rutas directas y prefijo `/api`.
  - Suite de integración exhaustiva en `apps/api/src/routes/precios-reglas.test.ts` con 4 tests pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Componente `apps/web/src/GestionListasYReglas.tsx` integrado en `apps/web/src/ConfiguracionPiloto.tsx` bajo la pestaña `🏷️ Listas & Descuentos por Volumen`:
    - Tab 1: Administración de listas de precios (creación, visualización de márgenes y eliminación).
    - Tab 2: Gestor de reglas de descuento por volumen (por rubro o producto, cantidad mínima, % off, pausa/activación).
    - Tab 3: Fijación manual de precios fijos por lista con buscador en vivo de artículos.
  - Carrito de venta en mostrador (`apps/web/src/App.tsx`):
    - Detección y aplicación inmediata de bonificaciones por cantidad con etiqueta visual `🏷️ {promo} (-{pct}%)`.
    - Selector ágil de lista de precios que **recalcula automáticamente** los precios y subtotales de todos los ítems cargados en el carrito al alternar entre Mostrador, Gremio o Mayorista.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero advertencias ni errores.
  - `pnpm test` superado al 100%.
  - Compilación de producción (`pnpm build`) exitosa.

---

## Fase 17B — Sugerencia Inteligente de Reabastecimiento y Órdenes de Compra Automáticas (Completada ✅)

Objetivo: optimizar el capital de trabajo de la ferretería calculando la rotación real de stock (consumo promedio diario en los últimos 30 días), proyectando días de autonomía hasta el quiebre de stock y sugiriendo reposiciones automáticas agrupadas por proveedor habitual para generar borradores de órdenes de compra correlativas (`OC-XXXX`) en un solo clic.

Estado:
- [x] Migración SQL `db/migrations/017_reabastecimiento_inteligente.sql`:
  - Adición de campos logísticos en tabla `producto`: `punto_pedido` (`numeric(14,3)`) y `lead_time_dias` (`integer`).
  - Creación de vista analítica `v_articulos_reabastecimiento`:
    - Métricas de rotación: unidades vendidas en los últimos 30 días y consumo promedio diario ($Ventas30d / 30.0$).
    - Punto de pedido dinámico: $\max(PuntoPedidoManual, StockMinimo + ConsumoDiario \times LeadTime)$.
    - Proyección de autonomía: cálculo en días de stock restante hasta el quiebre.
    - Clasificación de nivel de urgencia: `quiebre`, `critico`, `preventivo`, `normal`.
    - Cantidad sugerida de compra y costo unitario estimado.
  - Permisos concedidos a `app_user` e integración en `apps/api/src/db/migrate.test.ts`.
- [x] Esquemas compartidos en `packages/shared`:
  - Tipos `SugerenciaReabastecimientoItem`, `ResumenReabastecimiento`.
  - Esquema Zod `generarOrdenesReabastecimientoSchema` con validación estricta de ítems, cantidades y condiciones de pago.
- [x] Backend API (`apps/api/src/routes/reabastecimiento.ts`):
  - `GET /reabastecimiento/sugerencias`: consulta analítica con filtros por urgencia (`quiebre`, `critico`, `preventivo`), proveedor y rubro.
  - `POST /reabastecimiento/generar-ordenes`: generación atómica de órdenes de compra correlativas en estado `borrador` agrupadas por proveedor con sus respectivos renglones en `item_orden_compra`.
  - Integración en `apps/api/src/server.ts` con rutas directas y prefijo `/api`.
  - Suite de integración en `apps/api/src/routes/reabastecimiento.test.ts` con 3 tests pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Componente `apps/web/src/ReabastecimientoInteligente.tsx`:
    - Tarjetas KPI con recuento de artículos en quiebre, stock crítico y nivel preventivo.
    - Filtros por nivel de urgencia, búsqueda por texto y selector de proveedor.
    - Tabla interactiva con selección múltiple mediante casillas de verificación, cálculo de subtotales e inputs de cantidad editable.
    - Generación agrupada de borradores de órdenes de compra con modal de confirmación y redirección inmediata a la pestaña de órdenes.
  - Subpestaña `🤖 Reabastecimiento Inteligente` integrada en `apps/web/src/ComprasProveedores.tsx`.
  - Alerta visual de stock en `apps/web/src/InicioDashboard.tsx` para avisar al cajero/encargado cuando existen artículos en quiebre o nivel crítico.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con 0 advertencias y 0 errores.
  - Suite completa de integración: 18 archivos de prueba, 98 tests pasando al 100%.
  - Compilación de producción (`pnpm build`) exitosa.

---

## Fase 18 — Acopio de Materiales y Entregas Parciales (Completada ✅)

Objetivo: permitir a constructoras, contratistas y clientes particulares congelar el precio de compra de materiales (cemento, arena, hierros, pinturas, etc.) por adelantado, dejando la mercadería en custodia del negocio para su retiro diferido en múltiples viajes de flete o entregas parciales documentadas con remitos oficiales correlativos (`REM-XXXX`), sin duplicar egresos de dinero y deduciendo el stock físico del Kardex únicamente al momento del despacho real.

Estado:
- [x] Migración SQL `db/migrations/018_acopio_materiales.sql`:
  - Tablas `acopio`, `item_acopio`, `remito_entrega_acopio`, `item_remito_entrega_acopio`.
  - Vista analítica `v_acopios_resumen` con cálculo de totales valorizados, unidades compradas, unidades entregadas, saldo pendiente y porcentaje de avance.
  - Secuencia correlativa para números de acopio (`ACP-XXXX`) y remitos de entrega (`REM-XXXX`).
  - Row Level Security (RLS) completo y permisos concedidos a `app_user`.
- [x] Esquemas compartidos en `packages/shared`:
  - `crearAcopioSchema`, `registrarEntregaAcopioSchema`, `CrearAcopioInput`, `RegistrarEntregaAcopioInput`, `AcopioResumenItem`, `AcopioDetalleCompleto`, `ItemAcopioDetalle`, `RemitoEntregaDetalle`.
  - Acciones de auditoría `crear_acopio` y `entrega_acopio` en `accionAuditoriaSchema` y entidad `acopio` en `entidadAuditoriaSchema`.
- [x] Backend API (`apps/api/src/routes/acopios.ts`):
  - `GET /acopios`: listado filtrado por cliente y estado (`activo`, `completado`, `cancelado`).
  - `GET /acopios/:id`: detalle completo con renglones de materiales, stock disponible en depósito e historial de remitos.
  - `POST /acopios`: registro de nuevo acopio con cálculo de subtotales en centavos (`aCentavos`/`deCentavos`), numeración correlativa y auditoría.
  - `POST /acopios/:id/entregas`: emisión de remito de entrega con validación estricta de saldo pendiente, descuento atómico en Kardex (`movimiento_stock` tipo `entrega_acopio`), transición automática a `completado` al entregar el 100% y auditoría.
  - `GET /acopios/cliente/:clienteId/saldo`: consulta ágil de saldos pendientes por cliente.
  - Suite de integración en `apps/api/src/routes/acopios.test.ts` con 4 tests pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Componente integral `apps/web/src/AcopiosMateriales.tsx`:
    - Tablero con listado de acopios, filtros por estado (`todos`, `activo`, `completado`) y buscador rápido.
    - Barra de progreso de entrega y tarjetas de unidades compradas vs entregadas y valor congelado.
    - Detalle completo con alerta visual si el stock físico en depósito es menor que el saldo acopiado pendiente de retiro.
    - Modal interactivo de nuevo acopio con buscador en vivo de clientes y catálogo de productos.
    - Modal de emisión de remito de entrega con datos de transporte (chofer, DNI, patente de camión) y control de topes por saldo.
    - Historial de remitos emitidos por acopio con detalle de materiales despachados y fecha/hora.
  - Integración en la navegación lateral de `apps/web/src/App.tsx` bajo la sección *Stock & Clientes*.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero advertencias y cero errores.
  - Suite completa de integración: **19 archivos de prueba, 102 tests pasando al 100%** en PostgreSQL real con Testcontainers.
  - Compilación de producción con Vite (`pnpm build`) exitosa.

---

## Fase 19 — Actualizador Masivo de Precios (Porcentaje por Rubro y Lista de Proveedor) (Completada ✅)

Objetivo: permitir a los dueños y encargados de la ferretería actualizar de forma inmediata y masiva los precios de costo y venta ante listas de inflación o cambios de fabricantes, aplicando aumentos porcentuales por rubro con reglas de redondeo comercial (al entero, múltiplos de $10, $50 o $100) y procesando listas de proveedores tabuladas por SKU o código de barras, con auditoría inmutable en `registro_auditoria`.

Estado:
- [x] Esquemas compartidos en `packages/shared`:
  - `reglaRedondeoPreciosSchema`, `baseActualizacionPrecioSchema`, `actualizarPreciosPorcentajeSchema`, `actualizarPreciosListaProveedorSchema`.
  - Función de utilidad matemática pura `aplicarRedondeoPrecio` operando en centavos enteros (`aCentavos`/`deCentavos`).
  - Suite de pruebas unitarias en `packages/shared/src/index.test.ts` (7 tests pasando al 100%).
- [x] Backend API (`apps/api/src/routes/productos.ts`):
  - `POST /productos/precios/previsualizar-aumento`: simula el impacto en memoria y calcula precios de venta proyectados por lista con redondeo comercial sin alterar la base de datos.
  - `POST /productos/precios/aplicar-aumento`: actualización atómica de costos base y recálculo con registro en `registro_auditoria` (acción `cambio_precio` sobre `articulo`).
  - `POST /productos/precios/actualizar-desde-lista`: conciliación y actualización por coincidencia de SKU o código de barras de pistola.
  - Suite de integración en `apps/api/src/routes/productos.test.ts` con 14 tests pasando al 100% en PostgreSQL real.
- [x] Frontend Web (`apps/web`):
  - Componente `apps/web/src/ActualizadorMasivoPrecios.tsx`:
    - Tab 1 (Aumento Porcentual): selector rápido de porcentajes (+5%, +10%, +15%, etc.), selector de rubro, base y regla de redondeo; botón de simulación con diff visual y confirmación definitiva.
    - Tab 2 (Lista de Proveedor): área de texto para pegar columnas de Excel, detección automática de artículos por SKU/EAN y procesamiento en lote.
  - Integración en `apps/web/src/CatalogoStock.tsx` mediante el botón `[⚡ Actualizar Precios]`.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con 0 advertencias y 0 errores.
  - Suite completa de integración: **19 archivos de prueba, 106 tests pasando al 100%**.
  - Compilación de producción con Vite (`pnpm build`) exitosa.

---

## Fase 20 — Logística de Envíos, Despachos y Hoja de Ruta para Fletero (Completada ✅)

Objetivo: coordinar integralmente las entregas a domicilio de materiales pesados (áridos, perfiles, bolsas de cemento, herramientas), armar hojas de ruta agrupadas por vehículo/fletero, optimizar el orden de paradas y registrar la rendición de cobranzas en contraentrega con firma y comprobante de entrega.

Estado:
- [x] Migración SQL `db/migrations/019_logistica_despachos.sql`:
  - Tablas `despacho_envio`, `hoja_ruta_fletero`, `item_hoja_ruta` con claves compuestas `(id, negocio_id)`, triggers inmutables y políticas RLS.
  - Vista agregada `v_despachos_resumen` con `with (security_invoker = true)` para cálculo de métricas en tiempo real.
- [x] Esquemas compartidos en `packages/shared`:
  - `crearDespachoEnvioSchema`, `actualizarDespachoEnvioSchema`, `crearHojaRutaSchema`, `actualizarItemHojaRutaSchema`, `cerrarHojaRutaSchema`.
- [x] Backend API (`apps/api/src/routes/logistica.ts`):
  - Endpoints para despacho de envíos: `GET /logistica/despachos`, `POST /logistica/despachos`, `GET /logistica/despachos/:id`, `PATCH /logistica/despachos/:id`.
  - Endpoints para hojas de ruta y fleteros: `GET /logistica/hojas-ruta`, `POST /logistica/hojas-ruta`, `GET /logistica/hojas-ruta/:id`, `PATCH /logistica/hojas-ruta/:id/items/:itemId`, `POST /logistica/hojas-ruta/:id/cerrar`.
  - Suite de integración backend en `apps/api/src/routes/logistica.test.ts` (4 tests pasando al 100%).
- [x] Frontend Web (`apps/web`):
  - Componente completo `apps/web/src/LogisticaDespachos.tsx` con tablero de estado (Pendientes, En Viaje, Entregados, Reprogramados), buscador por cliente/remito/zona, modal de nuevo envío, asistente de armado de hoja de ruta con selección múltiple, control de paradas y botón de impresión de hoja de ruta con remitos.
  - Integración en navegación lateral y renderizado de `apps/web/src/App.tsx` (`tab-logistica`).
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero advertencias y cero errores.
  - Suite completa de integración: **20 archivos de prueba, 110 tests pasando al 100%** en PostgreSQL real con Testcontainers.
  - Compilación de producción con Vite (`pnpm build`) exitosa.

---

## Fase 21 — Enlaces Directos de WhatsApp para Comprobantes y Cobranzas (Completada ✅)

Objetivo: permitir el envío inmediato con un solo clic de tickets de venta, estados de cuenta corriente con saldo deudor y datos de CBU/Alias para transferencia, presupuestos cotizados, avisos de envío logístico en camino con datos del chofer y órdenes de compra a proveedores mediante la API oficial de enlaces `wa.me`, con normalización automática de números telefónicos de Argentina.

Estado:
- [x] Lógica de normalización y formateo en `packages/shared`:
  - `normalizarTelefonoWhatsApp(telefono)`: limpieza de caracteres especiales, remoción de prefijos `0` y `15` en celulares de AMBA y todas las provincias argentinas, e incorporación automática del código de país `549`.
  - `generarLinkWhatsApp(telefono, mensaje)`: construcción de URL `https://wa.me/...` con parámetros URL encoded seguros.
  - Generadores de plantillas rioplatenses personalizadas:
    - `formatearMensajeTicket`: saludo al cliente, detalle de comprobante, medio de pago y total en pesos.
    - `formatearMensajeCtaCte`: extracto de saldo deudor, límite de crédito y datos bancarios para transferencia (Alias/CBU).
    - `formatearMensajePresupuesto`: detalle de cotización, monto y plazo de validez en días.
    - `formatearMensajeDespacho`: notificación de pedido en camino, dirección de destino, chofer/fletero asignado y cobro contraentrega si aplica.
    - `formatearMensajeOrdenCompra`: solicitud formal de compra enviada al proveedor con cantidad de artículos.
  - Suite de pruebas unitarias en `packages/shared/src/index.test.ts` (8 tests pasando al 100%).
- [x] Integración en el Frontend (`apps/web`):
  - `App.tsx`: botón `[📲 WhatsApp]` en el banner de comprobante emitido en mostrador con diálogo de confirmación/ingreso de celular del cliente.
  - `ClientesCtaCte.tsx`: botón directo `[📲 WhatsApp]` en la tabla de clientes para cuentas con saldo deudor y botón destacado en la ficha de extracto del cliente.
  - `Presupuestos.tsx`: botón directo `[📲 WhatsApp]` en el modal de detalle del presupuesto para compartir al cliente.
  - `LogisticaDespachos.tsx`: botón `[📲 Wsp]` en la grilla de despachos para alertar al destinatario sobre su envío.
  - `ComprasProveedores.tsx`: botón `[📲 WhatsApp]` al lado de la recepción para compartir órdenes de compra al proveedor.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los paquetes.
  - `pnpm lint` con cero advertencias y cero errores.
  - Suite completa de integración: **20 archivos de prueba, 111 tests pasando al 100%** en PostgreSQL real con Testcontainers.
  - Compilación de producción con Vite (`pnpm build`) exitosa.

---

## Fase 22 — Múltiples Depósitos y Transferencias Internas de Stock (Completada ✅)

Objetivo: permitir a ferreterías y corralones administrar múltiples ubicaciones físicas de almacenamiento (salón comercial, trastienda, galpones y patios de corralón), consultar el stock segregado por depósito y registrar transferencias internas con impacto atómico e inmutable en el Kardex de movimientos de stock.

Estado:
- [x] Migración SQL `db/migrations/020_multiples_depositos_transferencias.sql`:
  - Tabla `deposito` con clave compuesta `(id, negocio_id)`, `es_principal` y políticas RLS.
  - Tabla `transferencia_stock` y tabla `item_transferencia_stock` con referencias foráneas compuestas y control de depósitos distintos (`origen <> destino`).
  - Columna `deposito_id` agregada a `movimiento_stock` y actualización de `movimiento_stock_tipo_check` para soportar `'transferencia_origen'` y `'transferencia_destino'`.
  - Vista agregada `v_stock_por_deposito` con `with (security_invoker = true)` para cálculo en tiempo real de inventario por ubicación física.
  - Actualización de función `sembrar_negocio` para inicializar el depósito principal predeterminado.
- [x] Esquemas compartidos en `packages/shared`:
  - `crearDepositoSchema`, `actualizarDepositoSchema`, `crearTransferenciaStockSchema`, `itemTransferenciaInputSchema`.
  - Tipos e interfaces: `DepositoItem`, `StockPorDepositoItem`, `TransferenciaStockResumen`, `TransferenciaStockCompleta`.
  - Auditoría integrada: acciones `crear_deposito` y `crear_transferencia_stock`.
- [x] Backend API (`apps/api/src/routes/depositos.ts`):
  - `GET /depositos`: listado de depósitos y sucursales.
  - `POST /depositos`: creación de nuevos depósitos (dueño / encargado) con auditoría inmutable.
  - `PATCH /depositos/:id`: actualización de datos y asignación de depósito principal.
  - `GET /depositos/:id/stock`: stock discriminado de artículos por depósito.
  - `GET /depositos/transferencias`: historial de transferencias internas con resumen de artículos.
  - `GET /depositos/transferencias/:id`: detalle completo y remito interno de transferencia.
  - `POST /depositos/transferencias`: procesamiento atómico que registra la cabecera, los ítems y genera simultáneamente los movimientos de salida (`out`) en origen y de entrada (`in`) en destino en `movimiento_stock`.
  - Suite de integración en `apps/api/src/routes/depositos.test.ts` (4 tests pasando al 100%).
- [x] Frontend Web (`apps/web`):
  - Componente completo `apps/web/src/DepositosTransferencias.tsx`:
    - Tab 1 (Stock por Depósito): selector dinámico de ubicación (Salón, Galpón, Patio), buscador instantáneo y tabla con semáforo de inventario disponible.
    - Tab 2 (Transferencias Internas): historial correlativo (`TRF-XXXX`), modal de nueva transferencia con selector de origen/destino y buscador de artículos con cantidades fraccionables, y modal de detalle para visualizar e imprimir el remito interno.
    - Tab 3 (Sucursales y Galpones): administración de puntos de venta/almacén con creación y edición rápida.
  - Integración en navegación lateral y renderizado de `apps/web/src/App.tsx` (`tab-depositos`).
  - Actualización de etiquetas de auditoría en `AuditoriaSistema.tsx`.
- [x] Verificación de calidad:
  - `pnpm typecheck` superado sin errores en todos los workspaces.
  - `pnpm lint` con cero advertencias y cero errores.
  - Suite completa de integración: **21 archivos de prueba, 115 tests pasando al 100%** en PostgreSQL real con Testcontainers.
  - Compilación de producción con Vite (`pnpm build`) exitosa.
