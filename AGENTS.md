# AGENTS.md — Sistema de gestión para ferreterías

Sistema web online (PWA) para ferreterías y comercios similares. Empieza por **caja y flujo de caja** y crece hacia stock, clientes, proveedores y facturación. La lógica de caja toma como modelo una planilla de Excel de una librería: una hoja por día con ventas por medio de cobro y gastos, y saldos encadenados entre hojas. Este sistema reemplaza esa lógica sin perder su simplicidad.

Leé `docs/plan-de-trabajo.md` antes de empezar una tarea. Trabajá siempre sobre UNA etapa a la vez.

## Stack (no cambiar sin pedirlo)

- Monorepo con pnpm workspaces, TypeScript estricto en todo.
- `apps/api`: Node.js + Fastify + Zod (validación) + Drizzle ORM. Logs con pino.
- `apps/web`: React + Vite + TanStack Query + Tailwind + shadcn/ui. PWA con cola local (IndexedDB) para vender sin internet.
- `packages/shared`: esquemas Zod y tipos compartidos entre api y web.
- Base de datos: PostgreSQL 15+. Migraciones SQL planas en `db/migrations/` (numeradas, nunca se editan una vez aplicadas; se agrega una nueva).
- Identidad: proveedor externo (Firebase Auth). El token trae `negocio_id` y `rol` como claims; la API los verifica en cada pedido.
- Tests: Vitest; los tests de base de datos corren contra un PostgreSQL real (testcontainers), nunca contra mocks ni SQLite.
- Despliegue: contenedor Docker para la API (Railway o Cloud Run) y hosting estático para la web. Configuración solo por variables de entorno.

## Lenguaje y nombres

- El dominio va en español de punta a punta: tablas, columnas, tipos y nombres de pantallas (`turno_caja`, `movimiento`, `efectivo_esperado`). En la base `snake_case`; en TypeScript `camelCase` (Drizzle hace el mapeo).
- La infraestructura y utilidades técnicas van en inglés (`logger`, `retry`, `buildServer`).
- Textos de la interfaz en español rioplatense. Moneda en pesos argentinos: `$ 1.234,50`.

## Reglas inviolables del dominio

Estas reglas no se negocian ni se "optimizan". Si una tarea parece pedir romperlas, detenete y avisá.

1. `movimiento` es un libro de **solo agregar**. Nunca `UPDATE` ni `DELETE`. Una corrección es un movimiento inverso con `revierte_id` (mismo tipo y monto, sentido contrario). Hay triggers que lo imponen; no los desactives.
2. **Los saldos no se guardan ni se tipean.** Se calculan desde los movimientos (vistas `v_resumen_turno` y `v_ventas_por_medio_rubro`). Prohibido agregar columnas tipo `saldo` que se actualicen a mano.
3. Dinero con `numeric(14,2)` en la base y strings decimales (o centavos enteros) en TypeScript. **Nunca `number` con coma flotante para sumar importes.** Cantidades con `numeric(14,3)` (se vende por metro, kilo, litro).
4. Todo turno se cierra con **arqueo**: efectivo contado vs. `efectivo_esperado`. La diferencia (sobrante o faltante) queda registrada. No existe cierre sin conteo.
5. Un movimiento solo se puede insertar en un turno abierto. Solo hay un turno abierto por caja.
6. El medio de pago es un dato, no una columna: `es_efectivo` decide si suma al cajón y `dias_acreditacion` alimenta el flujo de caja proyectado. El **rubro** (herramientas, electricidad, pinturas, etc., definidos por cada negocio) es otra dimensión, independiente del medio de pago.
7. Los ids de `venta` y `movimiento` los genera el cliente (UUID). Insertar con `on conflict (id) do nothing`: reintentar nunca duplica. Esto es lo que permite vender sin conexión.
8. **Multi-negocio desde el día uno.** Toda tabla lleva `negocio_id`, toda clave foránea es compuesta `(id, negocio_id)` y todas tienen RLS. La API abre cada transacción con `select set_config('app.negocio_id', $1, true)` tomando el valor del token, nunca del body ni de la URL.
9. El usuario de la aplicación en PostgreSQL **no** es dueño de las tablas ni superusuario (si lo fuera, RLS no se aplica).

## Seguridad

- Nunca escribas secretos, tokens ni cadenas de conexión en el repo, en este archivo ni en los prompts. Solo `.env` local (ignorado por git) y variables del proveedor de despliegue.
- Validá toda entrada con Zod en el borde de la API. Consultas siempre parametrizadas.
- Autorización por rol en cada ruta: `cajero` (vende, registra egresos del turno), `encargado` (cierra turnos, anula, ve reportes), `dueno` (todo, incluida configuración).
- Cada acción sensible (anular, cerrar turno, cambiar precios) deja registro de quién y cuándo.
- Pedí confirmación humana antes de ejecutar migraciones sobre cualquier base que no sea la local y antes de cualquier despliegue.

## Comandos

```
pnpm install            # dependencias
pnpm dev                # api + web en modo desarrollo
pnpm typecheck          # tsc en todos los paquetes
pnpm lint               # eslint
pnpm test               # vitest (levanta PostgreSQL de prueba)
pnpm db:migrate         # aplica db/migrations/*.sql en orden
```

## Cómo trabajar

- Antes de escribir código en una tarea nueva, mostrá un plan corto con los archivos que vas a tocar.
- Cambios chicos y commits chicos (un tema por commit, mensajes en español, imperativo: "Agrega cierre de turno con arqueo").
- Cada funcionalidad nueva trae sus tests. Para todo lo que toque dinero, agregá casos de borde: reversiones, pagos mixtos, turno cerrado, reintentos con el mismo id, y que un negocio **no** vea ni referencie datos de otro.
- Un agente por zona: quien trabaja en `apps/api` no toca `apps/web` y viceversa; los cambios en `packages/shared` o `db/` se coordinan antes.
- No agregues dependencias nuevas sin justificarlo en el plan.
- No implementes cuenta corriente de clientes, stock, compras ni facturación hasta que `docs/plan-de-trabajo.md` indique esa fase.
- No inventes reglas de negocio. Si falta una definición (por ejemplo, cómo se redondea un descuento), dejá un comentario `TODO(definir):` y preguntá.

## Definición de terminado

Una tarea está terminada cuando: pasa `pnpm typecheck && pnpm lint && pnpm test`, las reglas inviolables siguen cumpliéndose, la interfaz se probó en el navegador integrado con un flujo completo (abrir turno, vender, egresar, cerrar con arqueo) y el plan de `docs/plan-de-trabajo.md` quedó actualizado con lo hecho.
