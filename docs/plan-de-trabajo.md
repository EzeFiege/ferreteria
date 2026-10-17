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

## Después del piloto (no empezar antes)

| Fase | Contenido |
|---|---|
| 2. Catálogo y stock | Productos, listas de precios, venta por ítem y por fracción, stock por movimientos, actualización masiva de precios por proveedor |
| 3. Clientes y proveedores | Cuenta corriente de clientes (por ejemplo, contratistas), cobranzas, compras, cuentas a pagar, cheques (incluidos los diferidos) |
| 4. Flujo proyectado | Acreditaciones de tarjeta/QR, cheques a fecha, vencimientos, margen por rubro |
| 5. Expansión | Facturación electrónica (verificar los requisitos vigentes de ARCA al llegar), multisucursal, integraciones, asistente con IA de solo lectura para consultas sobre los reportes |

Regla para la Fase 5 con IA: el asistente consulta únicamente vistas de reporte con un rol de solo lectura y RLS; jamás escribe en el libro de movimientos.
