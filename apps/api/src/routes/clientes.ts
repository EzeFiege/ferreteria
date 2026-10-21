import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  ajusteCtaCteSchema,
  guardarClienteAutorizadoSchema,
  guardarClienteSchema,
  registrarCobranzaCtaCteSchema,
} from '@ferreteria/shared';
import { withTenantTransaction } from '../db/context.js';
import {
  cliente,
  clienteAutorizado,
  movimiento,
  medioPago,
  movimientoCtaCte,
  turnoCaja,
} from '../db/schema.js';
import { registrarAsientoAutomatico } from '../services/contabilidad-service.js';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';

export interface ClientesRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
  verifyToken?: TokenVerifier | undefined;
}

export interface SaldoClienteRow {
  id: string;
  codigo: string;
  nombre: string;
  cuitDni: string | null;
  condicionIva: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  listaPrecioId: string | null;
  listaPrecioNombre: string | null;
  limiteCredito: string;
  diasPlazoCredito: number;
  activo: boolean;
  totalDebitos: string;
  totalCreditos: string;
  saldoDeudor: string;
  creditoDisponible: string;
  excedidoLimite: boolean;
}

export interface MovimientoCtaCteRow {
  id: string;
  tipo: string;
  sentido: string;
  monto: string;
  descripcion: string | null;
  ventaId: string | null;
  movimientoCajaId: string | null;
  revierteId: string | null;
  creadoEn: string;
  autorizadoNombre: string | null;
  autorizadoDni: string | null;
  usuarioNombre: string | null;
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
      error: 'Datos inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'clientes' }, 'Error en ruta de clientes');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerClientesRoutes(
  app: FastifyInstance,
  options: ClientesRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar clientes con saldo y filtros
  app.get('/clientes', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = request.query as {
        q?: string;
        soloConDeuda?: string;
      };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          let sqlQuery = `
            select
              v.cliente_id as id,
              v.codigo,
              v.nombre,
              v.cuit_dni as "cuitDni",
              v.condicion_iva as "condicionIva",
              v.telefono,
              v.email,
              v.direccion,
              v.lista_precio_id as "listaPrecioId",
              lp.nombre as "listaPrecioNombre",
              v.limite_credito as "limiteCredito",
              v.dias_plazo_credito as "diasPlazoCredito",
              v.activo,
              v.total_debitos as "totalDebitos",
              v.total_creditos as "totalCreditos",
              v.saldo_deudor as "saldoDeudor",
              v.credito_disponible as "creditoDisponible",
              v.excedido_limite as "excedidoLimite"
            from v_saldo_cliente v
            left join lista_precio lp on lp.id = v.lista_precio_id
            where v.negocio_id = $1
          `;
          const params: unknown[] = [claims.negocioId];

          if (query.q && query.q.trim()) {
            params.push(`%${query.q.trim()}%`);
            sqlQuery += ` and (v.nombre ilike $${params.length} or v.codigo ilike $${params.length} or v.cuit_dni ilike $${params.length})`;
          }

          if (query.soloConDeuda === 'true') {
            sqlQuery += ` and v.saldo_deudor > 0`;
          }

          sqlQuery += ` order by v.nombre asc`;

          const res = await client.query<SaldoClienteRow>(sqlQuery, params);
          return res.rows;
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Obtener un cliente en detalle con autorizados y saldo
  app.get('/clientes/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const { id } = request.params as { id: string };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          const resSaldo = await client.query<SaldoClienteRow>(
            `select
              v.cliente_id as id,
              v.codigo,
              v.nombre,
              v.cuit_dni as "cuitDni",
              v.condicion_iva as "condicionIva",
              v.telefono,
              v.email,
              v.direccion,
              v.lista_precio_id as "listaPrecioId",
              lp.nombre as "listaPrecioNombre",
              v.limite_credito as "limiteCredito",
              v.dias_plazo_credito as "diasPlazoCredito",
              v.activo,
              v.total_debitos as "totalDebitos",
              v.total_creditos as "totalCreditos",
              v.saldo_deudor as "saldoDeudor",
              v.credito_disponible as "creditoDisponible",
              v.excedido_limite as "excedidoLimite"
            from v_saldo_cliente v
            left join lista_precio lp on lp.id = v.lista_precio_id
            where v.cliente_id = $1 and v.negocio_id = $2`,
            [id, claims.negocioId],
          );

          const clienteEncontrado = resSaldo.rows[0];
          if (!clienteEncontrado) {
            throw new AuthError('Cliente no encontrado', 404);
          }

          const autorizados = await db
            .select()
            .from(clienteAutorizado)
            .where(
              and(
                eq(clienteAutorizado.clienteId, id),
                eq(clienteAutorizado.negocioId, claims.negocioId),
                eq(clienteAutorizado.activo, true),
              ),
            );

          return {
            cliente: clienteEncontrado,
            autorizados,
          };
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Crear cliente
  app.post('/clientes', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = guardarClienteSchema.parse(request.body);

      const nuevo = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          let codigo = body.codigo;
          if (!codigo || !codigo.trim()) {
            const countRes = await client.query<{ total: string }>(
              'select count(*)::text as total from cliente where negocio_id = $1',
              [claims.negocioId],
            );
            const proximoNumero = (Number(countRes.rows[0]?.total ?? '0') + 1)
              .toString()
              .padStart(3, '0');
            codigo = `CLI-${proximoNumero}`;
          }

          const [insertado] = await db
            .insert(cliente)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              codigo,
              nombre: body.nombre,
              cuitDni: body.cuitDni || null,
              condicionIva: body.condicionIva,
              telefono: body.telefono || null,
              email: body.email || null,
              direccion: body.direccion || null,
              listaPrecioId: body.listaPrecioId || null,
              limiteCredito: body.limiteCredito,
              diasPlazoCredito: body.diasPlazoCredito,
              activo: body.activo,
              notas: body.notas || null,
            })
            .returning();

          return insertado;
        },
      );

      return await reply.code(201).send(nuevo);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Editar cliente
  app.put('/clientes/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = guardarClienteSchema.parse(request.body);

      const actualizado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [modificado] = await db
            .update(cliente)
            .set({
              codigo: body.codigo,
              nombre: body.nombre,
              cuitDni: body.cuitDni || null,
              condicionIva: body.condicionIva,
              telefono: body.telefono || null,
              email: body.email || null,
              direccion: body.direccion || null,
              listaPrecioId: body.listaPrecioId || null,
              limiteCredito: body.limiteCredito,
              diasPlazoCredito: body.diasPlazoCredito,
              activo: body.activo,
              notas: body.notas || null,
            })
            .where(
              and(eq(cliente.id, id), eq(cliente.negocioId, claims.negocioId)),
            )
            .returning();

          if (!modificado) {
            throw new AuthError('Cliente no encontrado', 404);
          }

          return modificado;
        },
      );

      return await reply.send(actualizado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Agregar persona autorizada a retirar
  app.post('/clientes/:id/autorizados', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = guardarClienteAutorizadoSchema.parse({
        ...request.body as Record<string, unknown>,
        clienteId: id,
      });

      const nuevoAutorizado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [insertado] = await db
            .insert(clienteAutorizado)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              clienteId: id,
              nombre: body.nombre,
              dni: body.dni || null,
              rolParentesco: body.rolParentesco || null,
              telefono: body.telefono || null,
              activo: body.activo,
            })
            .returning();

          return insertado;
        },
      );

      return await reply.code(201).send(nuevoAutorizado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Cuenta corriente: listar movimientos cronológicos con saldo
  app.get('/clientes/:id/cuenta-corriente', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const { id } = request.params as { id: string };

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Obtener saldo consolidado
          const resSaldo = await client.query<SaldoClienteRow>(
            `select
              v.cliente_id as id,
              v.codigo,
              v.nombre,
              v.cuit_dni as "cuitDni",
              v.limite_credito as "limiteCredito",
              v.dias_plazo_credito as "diasPlazoCredito",
              v.total_debitos as "totalDebitos",
              v.total_creditos as "totalCreditos",
              v.saldo_deudor as "saldoDeudor",
              v.credito_disponible as "creditoDisponible",
              v.excedido_limite as "excedidoLimite"
            from v_saldo_cliente v
            where v.cliente_id = $1 and v.negocio_id = $2`,
            [id, claims.negocioId],
          );

          const clienteEncontrado = resSaldo.rows[0];
          if (!clienteEncontrado) {
            throw new AuthError('Cliente no encontrado', 404);
          }

          // Obtener movimientos de la cta cte
          const resMovs = await client.query<MovimientoCtaCteRow>(
            `select
              mcc.id,
              mcc.tipo,
              mcc.sentido,
              mcc.monto,
              mcc.descripcion,
              mcc.venta_id as "ventaId",
              mcc.movimiento_caja_id as "movimientoCajaId",
              mcc.revierte_id as "revierteId",
              mcc.creado_en as "creadoEn",
              ca.nombre as "autorizadoNombre",
              ca.dni as "autorizadoDni",
              u.nombre as "usuarioNombre"
            from movimiento_cta_cte mcc
            left join cliente_autorizado ca on ca.id = mcc.autorizado_retiro_id
            left join usuario u on u.id = mcc.creado_por
            where mcc.cliente_id = $1 and mcc.negocio_id = $2
            order by mcc.creado_en asc, mcc.id asc`,
            [id, claims.negocioId],
          );

          return {
            cliente: clienteEncontrado,
            movimientos: resMovs.rows,
          };
        },
      );

      return await reply.send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Cobranza en caja: ingresa dinero en el turno activo y acredita la cta cte
  app.post('/clientes/:id/cobranzas', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = registrarCobranzaCtaCteSchema.parse({
        ...request.body as Record<string, unknown>,
        clienteId: id,
      });

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          // Verificar que el turno esté abierto
          const [turno] = await db
            .select()
            .from(turnoCaja)
            .where(
              and(
                eq(turnoCaja.id, body.turnoId),
                eq(turnoCaja.negocioId, claims.negocioId),
              ),
            );

          if (!turno) {
            throw new AuthError('El turno de caja especificado no existe', 404);
          }

          if (turno.cierraEn !== null) {
            throw new AuthError(
              'No se pueden registrar cobranzas en un turno cerrado',
              400,
            );
          }

          // Verificar que el cliente existe
          const [c] = await db
            .select()
            .from(cliente)
            .where(
              and(eq(cliente.id, id), eq(cliente.negocioId, claims.negocioId)),
            );

          if (!c) {
            throw new AuthError('Cliente no encontrado', 404);
          }

          // 1. Insertar movimiento de caja (ingreso extra / cobranza)
          const descCobro =
            body.descripcion ||
            `Cobranza cta cte ${c.codigo} · ${c.nombre}`;

          const [movCaja] = await db
            .insert(movimiento)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              turnoId: body.turnoId,
              tipo: 'ingreso_extra',
              sentido: 'in',
              monto: body.monto,
              medioPagoId: body.medioPagoId,
              descripcion: descCobro,
              creadoPor: claims.usuarioId,
            })
            .onConflictDoNothing({ target: movimiento.id })
            .returning();

          // 2. Insertar movimiento en cuenta corriente (crédito que reduce la deuda)
          const [movCtaCte] = await db
            .insert(movimientoCtaCte)
            .values({
              negocioId: claims.negocioId,
              clienteId: id,
              tipo: 'credito_cobranza',
              sentido: 'credito',
              monto: body.monto,
              movimientoCajaId: movCaja?.id ?? body.id,
              descripcion: descCobro,
              creadoPor: claims.usuarioId,
            })
            .returning();

          // Generar asiento contable automático de cobranza
          const [mpCobro] = await db
            .select()
            .from(medioPago)
            .where(eq(medioPago.id, body.medioPagoId));

          const cuentaDebe = mpCobro?.esEfectivo ? '1.1.01' : '1.1.02';

          await registrarAsientoAutomatico(client, {
            negocioId: claims.negocioId,
            concepto: `Cobranza cta cte ${c.codigo} · ${c.nombre}`,
            origen: 'cobro_cta_cte',
            referenciaId: movCtaCte?.id ?? body.id,
            usuarioId: claims.usuarioId,
            renglones: [
              {
                cuentaCodigo: cuentaDebe,
                debe: body.monto,
                haber: '0.00',
                descripcion: `Ingreso por cobranza cta cte (${mpCobro?.nombre ?? 'Cobro'})`,
              },
              {
                cuentaCodigo: '1.1.04', // Deudores por Ventas (Cta Cte)
                debe: '0.00',
                haber: body.monto,
                descripcion: `Cancelación crédito cliente ${c.nombre}`,
              },
            ],
          });

          // 3. Obtener nuevo saldo consolidado
          const saldoRes = await client.query<SaldoClienteRow>(
            `select * from v_saldo_cliente where cliente_id = $1 and negocio_id = $2`,
            [id, claims.negocioId],
          );

          return {
            movimientoCaja: movCaja,
            movimientoCtaCte: movCtaCte,
            saldo: saldoRes.rows[0],
          };
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 8. Ajuste manual de cuenta corriente (solo encargado o dueño)
  app.post('/clientes/:id/ajustes', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const { id } = request.params as { id: string };
      const body = ajusteCtaCteSchema.parse({
        ...(request.body as Record<string, unknown>),
        clienteId: id,
      });

      const sentido = body.tipo === 'ajuste_debito' ? 'debito' : 'credito';

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          const [mov] = await db
            .insert(movimientoCtaCte)
            .values({
              id: body.id,
              negocioId: claims.negocioId,
              clienteId: id,
              tipo: body.tipo,
              sentido,
              monto: body.monto,
              descripcion: body.descripcion,
              creadoPor: claims.usuarioId,
            })
            .onConflictDoNothing({ target: movimientoCtaCte.id })
            .returning();

          const saldoRes = await client.query<SaldoClienteRow>(
            `select * from v_saldo_cliente where cliente_id = $1 and negocio_id = $2`,
            [id, claims.negocioId],
          );

          return {
            movimientoCtaCte: mov,
            saldo: saldoRes.rows[0],
          };
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
