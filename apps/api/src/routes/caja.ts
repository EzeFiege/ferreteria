import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  abrirTurnoSchema,
  cerrarTurnoSchema,
  deCentavos,
  registrarMovimientoCajaSchema,
  registrarVentaSchema,
  revertirMovimientoSchema,
  uuidSchema,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  createAuthToken,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { registrarAsientoAutomatico } from '../services/contabilidad-service.js';
import { registrarAuditoria } from '../services/auditoria-service.js';
import {
  caja,
  categoria,
  medioPago,
  movimiento,
  movimientoCtaCte,
  movimientoStock,
  producto,
  rubro,
  turnoCaja,
  venta,
  ventaItem,
} from '../db/schema.js';

export interface CajaRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

interface PgDatabaseError {
  code?: string;
  constraint?: string;
  message?: string;
}

interface ResumenTurnoRow {
  turno_id: string;
  negocio_id: string;
  caja_id: string;
  abre_en: Date;
  cierra_en: Date | null;
  efectivo_inicial: string;
  entradas_efectivo: string;
  salidas_efectivo: string;
  efectivo_esperado: string;
  efectivo_contado: string | null;
  diferencia: string | null;
}

interface VentasPorMedioRubroRow {
  negocio_id: string;
  turno_id: string;
  medio_pago: string;
  rubro: string;
  total: string;
}

function normalizarMonto(monto: string): string {
  return deCentavos(aCentavos(monto));
}

function mapResumenTurno(row: ResumenTurnoRow) {
  return {
    turnoId: row.turno_id,
    negocioId: row.negocio_id,
    cajaId: row.caja_id,
    abreEn: row.abre_en,
    cierraEn: row.cierra_en,
    efectivoInicial: normalizarMonto(row.efectivo_inicial),
    entradasEfectivo: normalizarMonto(row.entradas_efectivo),
    salidasEfectivo: normalizarMonto(row.salidas_efectivo),
    efectivoEsperado: normalizarMonto(row.efectivo_esperado),
    efectivoContado:
      row.efectivo_contado !== null
        ? normalizarMonto(row.efectivo_contado)
        : null,
    diferencia:
      row.diferencia !== null ? normalizarMonto(row.diferencia) : null,
  };
}

function handleRouteError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos de entrada inválidos',
      detalles: err.issues,
    });
  }

  const pgErr = err as PgDatabaseError;
  if (pgErr.code === '23505') {
    if (pgErr.constraint === 'turno_abierto_unico') {
      return reply
        .code(409)
        .send({ error: 'Ya existe un turno abierto para esta caja' });
    }
    if (pgErr.constraint === 'movimiento_una_reversion') {
      return reply
        .code(409)
        .send({ error: 'Este movimiento ya fue revertido anteriormente' });
    }
    return reply.code(409).send({ error: 'Conflicto de unicidad en el registro' });
  }

  if (pgErr.code === '23503') {
    return reply.code(400).send({
      error:
        'Referencia inválida o perteneciente a otro negocio (violación de clave foránea compuesta)',
    });
  }

  if (pgErr.code === 'P0001') {
    return reply
      .code(409)
      .send({ error: pgErr.message ?? 'Regla de negocio rechazada por la base' });
  }

  request.log.error({ err }, 'Error inesperado en ruta de caja');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

const DEMO_NEGOCIO_ID = '10000000-0000-4000-8000-000000000001';
const DEMO_SUCURSAL_ID = '10000000-0000-4000-8000-000000000002';
const DEMO_CAJA_ID = '10000000-0000-4000-8000-000000000003';
const DEMO_CAJERO_ID = '10000000-0000-4000-8000-000000000004';
const DEMO_ENCARGADO_ID = '10000000-0000-4000-8000-000000000005';
const DEMO_DUENO_ID = '10000000-0000-4000-8000-000000000006';

export function registerCajaRoutes(
  app: FastifyInstance,
  options: CajaRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 0. Contexto inicial para la pantalla de mostrador (siembra negocio local si no existe)
  app.get('/contexto-mostrador', async (request, reply) => {
    try {
      const resultado = await withTenantTransaction(
        pool,
        DEMO_NEGOCIO_ID,
        async ({ db, client }) => {
          await client.query(
            `insert into negocio (id, nombre) values ($1, 'Ferretería El Tornillo') on conflict (id) do nothing`,
            [DEMO_NEGOCIO_ID],
          );
          await client.query(
            `insert into sucursal (id, negocio_id, nombre) values ($1, $2, 'Casa Central') on conflict (id) do nothing`,
            [DEMO_SUCURSAL_ID, DEMO_NEGOCIO_ID],
          );
          await client.query(
            `insert into caja (id, negocio_id, sucursal_id, nombre) values ($1, $2, $3, 'Caja Mostrador 1') on conflict (id) do nothing`,
            [DEMO_CAJA_ID, DEMO_NEGOCIO_ID, DEMO_SUCURSAL_ID],
          );
          await client.query(
            `insert into usuario (id, negocio_id, proveedor_uid, nombre, rol) values
              ($1, $4, 'demo-cajero', 'Juan (Cajero)', 'cajero'),
              ($2, $4, 'demo-encargado', 'Marta (Encargada)', 'encargado'),
              ($3, $4, 'demo-dueno', 'Roberto (Dueño)', 'dueno')
             on conflict (id) do nothing`,
            [DEMO_CAJERO_ID, DEMO_ENCARGADO_ID, DEMO_DUENO_ID, DEMO_NEGOCIO_ID],
          );

          const mediosExistentes = await db.select().from(medioPago);
          if (mediosExistentes.length === 0) {
            await client.query('select sembrar_negocio($1)', [DEMO_NEGOCIO_ID]);
          }

          for (const nombreRubro of [
            'Herramientas',
            'Electricidad',
            'Pinturas',
            'Bulonería',
            'Plomería',
          ]) {
            await client.query(
              `insert into rubro (negocio_id, nombre) values ($1, $2) on conflict (negocio_id, nombre) do nothing`,
              [DEMO_NEGOCIO_ID, nombreRubro],
            );
          }

          const todasLasCajas = await db.select().from(caja);
          const cajaActual =
            todasLasCajas.find((c) => c.id === DEMO_CAJA_ID) ?? todasLasCajas[0];
          const medios = await db.select().from(medioPago);
          const rubros = await db.select().from(rubro);
          const categorias = await db.select().from(categoria);

          const turnoAbiertoRes = await client.query<{ id: string }>(
            'select id from turno_caja where caja_id = $1 and cierra_en is null limit 1',
            [DEMO_CAJA_ID],
          );
          const turnoAbiertoId = turnoAbiertoRes.rows[0]?.id ?? null;

          return {
            negocioId: DEMO_NEGOCIO_ID,
            negocioNombre: 'Ferretería El Tornillo',
            caja: cajaActual,
            cajas: todasLasCajas,
            mediosPago: medios.filter((m) => m.activo),
            rubros,
            categorias: categorias.filter((c) => c.tipo === 'egreso'),
            turnoAbiertoId,
            operadores: [
              {
                id: DEMO_CAJERO_ID,
                nombre: 'Juan (Cajero)',
                rol: 'cajero' as const,
                token: createAuthToken({
                  negocio_id: DEMO_NEGOCIO_ID,
                  usuario_id: DEMO_CAJERO_ID,
                  rol: 'cajero',
                }),
              },
              {
                id: DEMO_ENCARGADO_ID,
                nombre: 'Marta (Encargada)',
                rol: 'encargado' as const,
                token: createAuthToken({
                  negocio_id: DEMO_NEGOCIO_ID,
                  usuario_id: DEMO_ENCARGADO_ID,
                  rol: 'encargado',
                }),
              },
              {
                id: DEMO_DUENO_ID,
                nombre: 'Roberto (Dueño)',
                rol: 'dueno' as const,
                token: createAuthToken({
                  negocio_id: DEMO_NEGOCIO_ID,
                  usuario_id: DEMO_DUENO_ID,
                  rol: 'dueno',
                }),
              },
            ],
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 1. Sugerencia de apertura de turno (efectivo contado del último cierre de esa caja)
  app.get('/cajas/:cajaId/sugerencia-apertura', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { cajaId?: string };
      const cajaId = uuidSchema.parse(params.cajaId);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [ultimoCerrado] = await db
            .select({
              id: turnoCaja.id,
              efectivoContado: turnoCaja.efectivoContado,
              cierraEn: turnoCaja.cierraEn,
            })
            .from(turnoCaja)
            .where(
              and(
                eq(turnoCaja.cajaId, cajaId),
                isNotNull(turnoCaja.cierraEn),
              ),
            )
            .orderBy(desc(turnoCaja.cierraEn))
            .limit(1);

          return {
            cajaId,
            efectivoSugerido: ultimoCerrado?.efectivoContado ?? '0.00',
            ultimoTurnoCerradoId: ultimoCerrado?.id ?? null,
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Abrir turno (si no se envía efectivoInicial, usa el efectivo contado del último cierre)
  app.post('/turnos/abrir', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = abrirTurnoSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [ultimoCerrado] = await db
            .select({
              id: turnoCaja.id,
              efectivoContado: turnoCaja.efectivoContado,
            })
            .from(turnoCaja)
            .where(
              and(
                eq(turnoCaja.cajaId, body.cajaId),
                isNotNull(turnoCaja.cierraEn),
              ),
            )
            .orderBy(desc(turnoCaja.cierraEn))
            .limit(1);

          const efectivoSugeridoUltimoCierre =
            ultimoCerrado?.efectivoContado ?? '0.00';
          const efectivoInicial =
            body.efectivoInicial ?? efectivoSugeridoUltimoCierre;

          const [nuevoTurno] = await db
            .insert(turnoCaja)
            .values({
              negocioId: claims.negocioId,
              cajaId: body.cajaId,
              abiertoPor: claims.usuarioId,
              efectivoInicial,
              notas: body.notas ?? null,
            })
            .returning();

          return {
            turno: nuevoTurno,
            efectivoSugeridoUltimoCierre,
          };
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Registrar venta (con uno o varios medios de pago, idempotente)
  app.post('/ventas', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = registrarVentaSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          const insertedVenta = await db
            .insert(venta)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              turnoId: body.turnoId,
              clienteId: body.clienteId ?? null,
              autorizadoRetiroId: body.autorizadoRetiroId ?? null,
              total: body.total,
              creadoPor: claims.usuarioId,
            })
            .onConflictDoNothing({ target: venta.id })
            .returning();

          const esNuevaVenta = insertedVenta.length > 0;

          if (esNuevaVenta && body.items && body.items.length > 0) {
            await db.insert(ventaItem).values(
              body.items.map((item) => ({
                negocioId: claims.negocioId,
                ventaId: body.id,
                productoId: item.productoId ?? null,
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precioUnit: item.precioUnit,
              })),
            );

            // Registro inmutable de egreso de stock para ítems vinculados a producto
            for (const item of body.items) {
              if (item.productoId) {
                const [prod] = await db
                  .select()
                  .from(producto)
                  .where(eq(producto.id, item.productoId));

                if (prod) {
                  let cantBase = Number(item.cantidad);
                  if (item.unidad === 'secundaria') {
                    const factor = Number(prod.factorConversion);
                    cantBase = factor > 0 ? cantBase / factor : cantBase;
                  }

                  await db.insert(movimientoStock).values({
                    negocioId: claims.negocioId,
                    productoId: item.productoId,
                    turnoId: body.turnoId,
                    ventaId: body.id,
                    tipo: 'egreso_venta',
                    sentido: 'out',
                    cantidad: item.cantidad,
                    unidad:
                      item.unidad === 'secundaria'
                        ? prod.unidadSecundaria ?? 'un'
                        : prod.unidadPrincipal,
                    cantidadBase: cantBase.toFixed(3),
                    costoUnitario: prod.costoBase,
                    notas: `Venta mostrador ${body.id}`,
                    creadoPor: claims.usuarioId,
                  });
                }
              }
            }
          }

          for (const pago of body.pagos) {
            await db
              .insert(movimiento)
              .values({
                id: pago.movimientoId,
                negocioId: claims.negocioId,
                turnoId: body.turnoId,
                tipo: 'venta',
                sentido: 'in',
                monto: pago.monto,
                medioPagoId: pago.medioPagoId,
                rubroId: pago.rubroId ?? null,
                ventaId: body.id,
                descripcion: pago.descripcion ?? null,
                creadoPor: claims.usuarioId,
              })
              .onConflictDoNothing({ target: movimiento.id });
          }

          if (esNuevaVenta && body.clienteId) {
            for (const pago of body.pagos) {
              const [mp] = await db
                .select()
                .from(medioPago)
                .where(eq(medioPago.id, pago.medioPagoId));

              if (mp && mp.nombre.toLowerCase().includes('cuenta corriente')) {
                await db.insert(movimientoCtaCte).values({
                  negocioId: claims.negocioId,
                  clienteId: body.clienteId,
                  tipo: 'debito_venta',
                  sentido: 'debito',
                  monto: pago.monto,
                  ventaId: body.id,
                  autorizadoRetiroId: body.autorizadoRetiroId ?? null,
                  descripcion: `Venta mostrador ${body.id}`,
                  creadoPor: claims.usuarioId,
                });
              }
            }
          }

          if (esNuevaVenta) {
            // Asiento contable automático de venta
            const renglonesDebe: Array<{ cuentaCodigo: string; debe: string; haber: string; descripcion?: string }> = [];
            for (const pago of body.pagos) {
              const [mp] = await db
                .select()
                .from(medioPago)
                .where(eq(medioPago.id, pago.medioPagoId));

              let codigoCuentaDebe = '1.1.02'; // Banco / Cuentas Virtuales por defecto
              if (mp) {
                const nombreLower = mp.nombre.toLowerCase();
                if (mp.esEfectivo) {
                  codigoCuentaDebe = '1.1.01'; // Caja Efectivo
                } else if (nombreLower.includes('cuenta corriente') || nombreLower.includes('cta cte')) {
                  codigoCuentaDebe = '1.1.04'; // Deudores por Ventas (Cta Cte)
                } else if (nombreLower.includes('cheque')) {
                  codigoCuentaDebe = '1.1.03'; // Valores a Depositar (Cheques)
                }
              }

              renglonesDebe.push({
                cuentaCodigo: codigoCuentaDebe,
                debe: pago.monto,
                haber: '0.00',
                descripcion: `Cobro ${mp?.nombre ?? 'Venta'}`,
              });
            }

            await registrarAsientoAutomatico(client, {
              negocioId: claims.negocioId,
              concepto: `Venta mostrador ${body.id.slice(0, 8)}`,
              origen: 'venta',
              referenciaId: body.id,
              usuarioId: claims.usuarioId,
              renglones: [
                ...renglonesDebe,
                {
                  cuentaCodigo: '4.1.01', // Ventas de Mercadería
                  debe: '0.00',
                  haber: body.total,
                  descripcion: 'Venta de mercaderías de mostrador',
                },
              ],
            });
          }

          const [ventaActual] = await db
            .select()
            .from(venta)
            .where(eq(venta.id, body.id));

          if (ventaActual === undefined) {
            throw new AuthError(
              'El identificador de venta colisiona con otro registro inaccesible',
              409,
            );
          }

          const movimientosVenta = await db
            .select()
            .from(movimiento)
            .where(eq(movimiento.ventaId, body.id));

          return {
            venta: ventaActual,
            movimientos: movimientosVenta,
            idempotente: !esNuevaVenta,
          };
        },
      );

      return await reply
        .code(resultado.idempotente ? 200 : 201)
        .send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Registrar egreso, retiro e ingreso extra (idempotentes)
  const registrarMovimientoSimple = async (
    request: FastifyRequest,
    reply: FastifyReply,
    tipo: 'egreso' | 'retiro' | 'ingreso_extra',
    sentido: 'in' | 'out',
  ): Promise<FastifyReply> => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = registrarMovimientoCajaSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          const inserted = await db
            .insert(movimiento)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              turnoId: body.turnoId,
              tipo,
              sentido,
              monto: body.monto,
              medioPagoId: body.medioPagoId,
              categoriaId: body.categoriaId ?? null,
              descripcion: body.descripcion ?? null,
              creadoPor: claims.usuarioId,
            })
            .onConflictDoNothing({ target: movimiento.id })
            .returning();

          const esNuevo = inserted.length > 0;
          const [movActual] = esNuevo
            ? inserted
            : await db
                .select()
                .from(movimiento)
                .where(eq(movimiento.id, body.id));

          if (movActual === undefined) {
            throw new AuthError(
              'El identificador de movimiento no está disponible',
              409,
            );
          }

          if (esNuevo) {
            if (tipo === 'egreso') {
              await registrarAsientoAutomatico(client, {
                negocioId: claims.negocioId,
                concepto: `Egreso caja ${body.id.slice(0, 8)}${body.descripcion ? ` - ${body.descripcion}` : ''}`,
                origen: 'egreso_caja',
                referenciaId: body.id,
                usuarioId: claims.usuarioId,
                renglones: [
                  {
                    cuentaCodigo: '5.1.02', // Gastos Generales y Operativos
                    debe: body.monto,
                    haber: '0.00',
                    descripcion: body.descripcion ?? 'Gastos generales',
                  },
                  {
                    cuentaCodigo: '1.1.01', // Caja Efectivo
                    debe: '0.00',
                    haber: body.monto,
                    descripcion: 'Salida de caja efectivo',
                  },
                ],
              });
            } else if (tipo === 'retiro') {
              await registrarAsientoAutomatico(client, {
                negocioId: claims.negocioId,
                concepto: `Retiro de efectivo ${body.id.slice(0, 8)}`,
                origen: 'egreso_caja',
                referenciaId: body.id,
                usuarioId: claims.usuarioId,
                renglones: [
                  {
                    cuentaCodigo: '1.1.02', // Banco y Cuentas Virtuales
                    debe: body.monto,
                    haber: '0.00',
                    descripcion: 'Retiro para depósito bancario / custodia',
                  },
                  {
                    cuentaCodigo: '1.1.01', // Caja Efectivo
                    debe: '0.00',
                    haber: body.monto,
                    descripcion: 'Salida de efectivo por retiro',
                  },
                ],
              });
            } else {
              await registrarAsientoAutomatico(client, {
                negocioId: claims.negocioId,
                concepto: `Ingreso extra caja ${body.id.slice(0, 8)}${body.descripcion ? ` - ${body.descripcion}` : ''}`,
                origen: 'manual',
                referenciaId: body.id,
                usuarioId: claims.usuarioId,
                renglones: [
                  {
                    cuentaCodigo: '1.1.01', // Caja Efectivo
                    debe: body.monto,
                    haber: '0.00',
                    descripcion: 'Entrada de efectivo',
                  },
                  {
                    cuentaCodigo: '4.1.02', // Otros Ingresos Operativos
                    debe: '0.00',
                    haber: body.monto,
                    descripcion: body.descripcion ?? 'Ingresos extraordinarios / varios',
                  },
                ],
              });
            }
          }

          return {
            movimiento: movActual,
            idempotente: !esNuevo,
          };
        },
      );

      return await reply
        .code(resultado.idempotente ? 200 : 201)
        .send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  };

  app.post('/movimientos/egreso', async (request, reply) =>
    registrarMovimientoSimple(request, reply, 'egreso', 'out'),
  );

  app.post('/movimientos/retiro', async (request, reply) =>
    registrarMovimientoSimple(request, reply, 'retiro', 'out'),
  );

  app.post('/movimientos/ingreso-extra', async (request, reply) =>
    registrarMovimientoSimple(request, reply, 'ingreso_extra', 'in'),
  );

  // 5. Revertir movimiento (solo encargado o dueno; inserta movimiento inverso con revierte_id)
  app.post('/movimientos/:movimientoId/revertir', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { movimientoId?: string };
      const movimientoOriginalId = uuidSchema.parse(params.movimientoId);
      const body = revertirMovimientoSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          // Si ya existe el movimiento de reversión con este mismo ID (reintento idempotente)
          const [reversionPrevia] = await db
            .select()
            .from(movimiento)
            .where(eq(movimiento.id, body.id));

          if (reversionPrevia !== undefined) {
            return {
              movimiento: reversionPrevia,
              idempotente: true,
            };
          }

          const [original] = await db
            .select()
            .from(movimiento)
            .where(eq(movimiento.id, movimientoOriginalId));

          if (original === undefined) {
            return null;
          }

          const sentidoInverso: 'in' | 'out' =
            original.sentido === 'in' ? 'out' : 'in';

          const inserted = await db
            .insert(movimiento)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              turnoId: body.turnoId ?? original.turnoId,
              tipo: original.tipo,
              sentido: sentidoInverso,
              monto: original.monto,
              medioPagoId: original.medioPagoId,
              rubroId: original.rubroId,
              categoriaId: original.categoriaId,
              ventaId: original.ventaId,
              descripcion:
                body.descripcion ?? `Reversión de movimiento ${original.id}`,
              revierteId: original.id,
              creadoPor: claims.usuarioId,
            })
            .onConflictDoNothing({ target: movimiento.id })
            .returning();

          const [reversionActual] =
            inserted.length > 0
              ? inserted
              : await db
                  .select()
                  .from(movimiento)
                  .where(eq(movimiento.id, body.id));

          if (reversionActual === undefined) {
            throw new AuthError('No se pudo registrar la reversión', 409);
          }

          if (inserted.length > 0) {
            await registrarAuditoria(client, {
              negocioId: claims.negocioId,
              usuarioId: claims.usuarioId,
              usuarioEmail: claims.email,
              rol: claims.rol,
              accion: 'anulacion_venta',
              entidad: 'venta',
              entidadId: original.ventaId ?? original.id,
              detalles: {
                movimientoOriginalId: original.id,
                reversionId: reversionActual.id,
                monto: reversionActual.monto,
                motivo: body.descripcion ?? null,
              },
            });
          }

          request.log.info(
            {
              accion: 'revertir_movimiento',
              movimientoOriginalId: original.id,
              reversionId: reversionActual.id,
              usuarioId: claims.usuarioId,
              negocioId: claims.negocioId,
            },
            'Movimiento revertido con asiento inverso',
          );

          return {
            movimiento: reversionActual,
            idempotente: inserted.length === 0,
          };
        },
      );

      if (resultado === null) {
        return await reply
          .code(404)
          .send({ error: 'Movimiento original no encontrado' });
      }

      return await reply
        .code(resultado.idempotente ? 200 : 201)
        .send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Cerrar turno con arqueo (solo encargado o dueno)
  app.post('/turnos/:turnoId/cerrar', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { turnoId?: string };
      const turnoId = uuidSchema.parse(params.turnoId);
      const body = cerrarTurnoSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          const [turnoExistente] = await db
            .select()
            .from(turnoCaja)
            .where(eq(turnoCaja.id, turnoId));

          if (turnoExistente === undefined) {
            return { estado: 'no_encontrado' as const };
          }

          if (turnoExistente.cierraEn !== null) {
            return { estado: 'ya_cerrado' as const };
          }

          await db
            .update(turnoCaja)
            .set({
              efectivoContado: body.efectivoContado,
              cerradoPor: claims.usuarioId,
              cierraEn: new Date(),
              notas: body.notas ?? turnoExistente.notas,
            })
            .where(eq(turnoCaja.id, turnoId));

          const resumenRes = await client.query<ResumenTurnoRow>(
            'select * from v_resumen_turno where turno_id = $1',
            [turnoId],
          );

          const filaResumen = resumenRes.rows[0];
          if (filaResumen === undefined) {
            throw new Error('No se pudo obtener el resumen del turno cerrado');
          }

          const resumen = mapResumenTurno(filaResumen);

          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            usuarioEmail: claims.email,
            rol: claims.rol,
            accion: 'arqueo_caja',
            entidad: 'turno_caja',
            entidadId: turnoId,
            detalles: {
              efectivoEsperado: resumen.efectivoEsperado,
              efectivoContado: resumen.efectivoContado,
              diferencia: resumen.diferencia,
              observaciones: body.notas ?? null,
            },
          });

          request.log.info(
            {
              accion: 'cerrar_turno',
              turnoId,
              cerradoPor: claims.usuarioId,
              negocioId: claims.negocioId,
              efectivoEsperado: resumen.efectivoEsperado,
              efectivoContado: resumen.efectivoContado,
              diferencia: resumen.diferencia,
            },
            'Turno de caja cerrado con arqueo',
          );

          return {
            estado: 'cerrado' as const,
            resumen,
          };
        },
      );

      if (resultado.estado === 'no_encontrado') {
        return await reply.code(404).send({ error: 'Turno no encontrado' });
      }
      if (resultado.estado === 'ya_cerrado') {
        return await reply
          .code(409)
          .send({ error: 'El turno ya se encuentra cerrado' });
      }

      return await reply.code(200).send(resultado.resumen);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Resumen del turno (calculado desde v_resumen_turno y v_ventas_por_medio_rubro)
  app.get('/turnos/:turnoId/resumen', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { turnoId?: string };
      const turnoId = uuidSchema.parse(params.turnoId);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const resumenRes = await client.query<ResumenTurnoRow>(
            'select * from v_resumen_turno where turno_id = $1',
            [turnoId],
          );

          const filaResumen = resumenRes.rows[0];
          if (filaResumen === undefined) {
            return null;
          }

          const ventasRes = await client.query<VentasPorMedioRubroRow>(
            'select negocio_id, turno_id, medio_pago, rubro, total from v_ventas_por_medio_rubro where turno_id = $1 order by medio_pago asc, rubro asc',
            [turnoId],
          );

          return {
            resumen: mapResumenTurno(filaResumen),
            ventasPorMedioRubro: ventasRes.rows.map((r) => ({
              negocioId: r.negocio_id,
              turnoId: r.turno_id,
              medioPago: r.medio_pago,
              rubro: r.rubro,
              total: r.total,
            })),
          };
        },
      );

      if (resultado === null) {
        return await reply.code(404).send({ error: 'Turno no encontrado' });
      }

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
