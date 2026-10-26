import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  cambiarEstadoDespachoSchema,
  cambiarEstadoHojaRutaSchema,
  crearDespachoEnvioSchema,
  crearHojaRutaSchema,
  registrarEntregaParadaSchema,
  uuidSchema,
  type DespachoEnvioResumen,
  type EstadoDespacho,
  type EstadoHojaRuta,
  type HojaRutaDetalleCompleto,
  type ItemHojaRutaDetalle,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { registrarAuditoria } from '../services/auditoria-service.js';

export interface LogisticaRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
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
      error: 'Datos de logística inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'logistica' }, 'Error en ruta de logística');
  const msg = err instanceof Error ? err.message : 'Error interno del servidor';
  return reply.code(500).send({ error: msg });
}

export function registerLogisticaRoutes(
  app: FastifyInstance,
  options: LogisticaRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar envíos / despachos con filtros
  app.get('/logistica/envios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = (request.query ?? {}) as {
        estado?: EstadoDespacho;
        clienteId?: string;
        sinAsignar?: string;
      };

      const envios = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<DespachoEnvioResumen[]> => {
          let sql = `
            select
              id, numero, venta_id, remito_acopio_id, cliente_id, cliente_nombre,
              cliente_cuit_dni, direccion_destino, localidad, contacto_nombre,
              contacto_telefono, franja_horaria, costo_flete::text, estado,
              notas_despacho, motivo_fallo, creado_por,
              to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
              to_char(entregado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as entregado_en,
              hoja_ruta_id, hoja_ruta_numero, fletero_nombre, vehiculo_patente, orden_parada
            from v_despachos_resumen
            where negocio_id = $1
          `;
          const params: unknown[] = [claims.negocioId];

          if (query.estado) {
            params.push(query.estado);
            sql += ` and estado = $${String(params.length)}`;
          }
          if (query.clienteId) {
            params.push(query.clienteId);
            sql += ` and cliente_id = $${String(params.length)}`;
          }
          if (query.sinAsignar === 'true') {
            sql += ' and hoja_ruta_id is null and estado = \'pendiente\'';
          }

          sql += ' order by creado_en desc';

          const res = await client.query<{
            id: string;
            numero: string;
            venta_id: string | null;
            remito_acopio_id: string | null;
            cliente_id: string;
            cliente_nombre: string;
            cliente_cuit_dni: string | null;
            direccion_destino: string;
            localidad: string | null;
            contacto_nombre: string;
            contacto_telefono: string | null;
            franja_horaria: string | null;
            costo_flete: string;
            estado: EstadoDespacho;
            notas_despacho: string | null;
            motivo_fallo: string | null;
            creado_por: string;
            creado_en: string;
            entregado_en: string | null;
            hoja_ruta_id: string | null;
            hoja_ruta_numero: string | null;
            fletero_nombre: string | null;
            vehiculo_patente: string | null;
            orden_parada: number | null;
          }>(sql, params);

          return res.rows.map((r): DespachoEnvioResumen => ({
            id: r.id,
            numero: r.numero,
            ventaId: r.venta_id,
            remitoAcopioId: r.remito_acopio_id,
            clienteId: r.cliente_id,
            clienteNombre: r.cliente_nombre,
            clienteCuitDni: r.cliente_cuit_dni,
            direccionDestino: r.direccion_destino,
            localidad: r.localidad,
            contactoNombre: r.contacto_nombre,
            contactoTelefono: r.contacto_telefono,
            franjaHoraria: r.franja_horaria,
            costoFlete: r.costo_flete,
            estado: r.estado,
            notasDespacho: r.notas_despacho,
            motivoFallo: r.motivo_fallo,
            creadoPor: r.creado_por,
            creadoEn: r.creado_en,
            entregadoEn: r.entregado_en,
            hojaRutaId: r.hoja_ruta_id,
            hojaRutaNumero: r.hoja_ruta_numero,
            fleteroNombre: r.fletero_nombre,
            vehiculoPatente: r.vehiculo_patente,
            ordenParada: r.orden_parada,
          }));
        },
      );

      return await reply.send({ envios });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Crear nuevo Despacho / Envío a Domicilio
  app.post('/logistica/envios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = crearDespachoEnvioSchema.parse(request.body);
      const usuarioNombre = claims.email ?? 'Operador';

      const nuevoDespacho = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Generar correlativo ENV-XXXX
          const maxNumRes = await client.query<{ max_num: number }>(
            `
            select coalesce(
              max(
                case
                  when numero ~ '^ENV-[0-9]+$' then substring(numero from 5)::integer
                  else 0
                end
              ),
              0
            ) as max_num
            from despacho_envio
            `,
          );
          const siguienteNum = (maxNumRes.rows[0]?.max_num ?? 0) + 1;
          const numeroEnvio = `ENV-${String(siguienteNum).padStart(4, '0')}`;

          const despachoId = randomUUID();
          await client.query(
            `
            insert into despacho_envio (
              id, negocio_id, numero, venta_id, remito_acopio_id, cliente_id,
              direccion_destino, localidad, contacto_nombre, contacto_telefono,
              franja_horaria, costo_flete, estado, notas_despacho, creado_por
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pendiente', $13, $14)
            `,
            [
              despachoId,
              claims.negocioId,
              numeroEnvio,
              body.ventaId ?? null,
              body.remitoAcopioId ?? null,
              body.clienteId,
              body.direccionDestino,
              body.localidad ?? null,
              body.contactoNombre,
              body.contactoTelefono ?? null,
              body.franjaHoraria ?? null,
              body.costoFlete,
              body.notasDespacho ?? null,
              usuarioNombre,
            ],
          );

          return { id: despachoId, numero: numeroEnvio };
        },
      );

      return await reply.code(201).send({
        ok: true,
        id: nuevoDespacho.id,
        numero: nuevoDespacho.numero,
        mensaje: `Envío ${nuevoDespacho.numero} registrado con éxito.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Cambiar estado de un despacho individual
  app.put('/logistica/envios/:id/estado', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { id: string };
      const envioId = uuidSchema.parse(params.id);
      const body = cambiarEstadoDespachoSchema.parse(request.body);

      await withTenantTransaction(pool, claims.negocioId, async ({ client }) => {
        const entregadoEnSql =
          body.estado === 'entregado' ? 'clock_timestamp()' : 'null';

        await client.query(
          `
          update despacho_envio
          set estado = $1,
              motivo_fallo = $2,
              entregado_en = ${entregadoEnSql}
          where id = $3
          `,
          [body.estado, body.motivoFallo ?? null, envioId],
        );
      });

      return await reply.send({
        ok: true,
        mensaje: `Estado del envío actualizado a '${body.estado}'.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Listar Hojas de Ruta
  app.get('/logistica/hojas-ruta', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const query = (request.query ?? {}) as {
        fecha?: string;
        estado?: EstadoHojaRuta;
      };

      const hojas = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          let sql = `
            select
              hr.id,
              hr.numero,
              to_char(hr.fecha_salida, 'YYYY-MM-DD') as fecha_salida,
              hr.fletero_nombre,
              hr.fletero_telefono,
              hr.vehiculo_patente,
              hr.estado,
              hr.observaciones,
              hr.creado_por,
              to_char(hr.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
              to_char(hr.cerrada_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as cerrada_en,
              count(ihr.id)::int as total_paradas,
              count(case when ihr.estado_parada = 'entregado' then 1 end)::int as paradas_entregadas
            from hoja_ruta_fletero hr
            left join item_hoja_ruta ihr on ihr.hoja_ruta_id = hr.id and ihr.negocio_id = hr.negocio_id
            where 1=1
          `;
          const params: unknown[] = [];

          if (query.fecha) {
            params.push(query.fecha);
            sql += ` and hr.fecha_salida = $${String(params.length)}::date`;
          }
          if (query.estado) {
            params.push(query.estado);
            sql += ` and hr.estado = $${String(params.length)}`;
          }

          sql += `
            group by
              hr.id, hr.negocio_id, hr.numero, hr.fecha_salida, hr.fletero_nombre,
              hr.fletero_telefono, hr.vehiculo_patente, hr.estado, hr.observaciones,
              hr.creado_por, hr.creado_en, hr.cerrada_en
            order by hr.fecha_salida desc, hr.creado_en desc
          `;

          const res = await client.query<{
            id: string;
            numero: string;
            fecha_salida: string;
            fletero_nombre: string;
            fletero_telefono: string | null;
            vehiculo_patente: string | null;
            estado: EstadoHojaRuta;
            observaciones: string | null;
            creado_por: string;
            creado_en: string;
            cerrada_en: string | null;
            total_paradas: number;
            paradas_entregadas: number;
          }>(sql, params);

          return res.rows.map((r) => ({
            id: r.id,
            numero: r.numero,
            fechaSalida: r.fecha_salida,
            fleteroNombre: r.fletero_nombre,
            fleteroTelefono: r.fletero_telefono,
            vehiculoPatente: r.vehiculo_patente,
            estado: r.estado,
            observaciones: r.observaciones,
            creadoPor: r.creado_por,
            creadoEn: r.creado_en,
            cerradaEn: r.cerrada_en,
            totalParadas: r.total_paradas,
            paradasEntregadas: r.paradas_entregadas,
          }));
        },
      );

      return await reply.send({ hojasRuta: hojas });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Detalle completo de Hoja de Ruta con sus paradas
  app.get('/logistica/hojas-ruta/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      const params = request.params as { id: string };
      const hojaId = uuidSchema.parse(params.id);

      const detalle = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }): Promise<HojaRutaDetalleCompleto | null> => {
          const resCab = await client.query<{
            id: string;
            numero: string;
            fecha_salida: string;
            fletero_nombre: string;
            fletero_telefono: string | null;
            vehiculo_patente: string | null;
            estado: EstadoHojaRuta;
            observaciones: string | null;
            creado_por: string;
            creado_en: string;
            cerrada_en: string | null;
          }>(
            `
            select
              id, numero, to_char(fecha_salida, 'YYYY-MM-DD') as fecha_salida,
              fletero_nombre, fletero_telefono, vehiculo_patente, estado,
              observaciones, creado_por,
              to_char(creado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as creado_en,
              to_char(cerrada_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as cerrada_en
            from hoja_ruta_fletero
            where id = $1
            `,
            [hojaId],
          );

          const cab = resCab.rows[0];
          if (!cab) return null;

          const resParadas = await client.query<{
            id: string;
            despacho_id: string;
            despacho_numero: string;
            cliente_nombre: string;
            direccion_destino: string;
            localidad: string | null;
            contacto_nombre: string;
            contacto_telefono: string | null;
            orden_parada: number;
            estado_parada: 'pendiente' | 'entregado' | 'no_entregado';
            entregado_en: string | null;
            observaciones_entrega: string | null;
          }>(
            `
            select
              ihr.id,
              ihr.despacho_id,
              d.numero as despacho_numero,
              c.nombre as cliente_nombre,
              d.direccion_destino,
              d.localidad,
              d.contacto_nombre,
              d.contacto_telefono,
              ihr.orden_parada,
              ihr.estado_parada,
              to_char(ihr.entregado_en, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as entregado_en,
              ihr.observaciones_entrega
            from item_hoja_ruta ihr
            join despacho_envio d on d.id = ihr.despacho_id and d.negocio_id = ihr.negocio_id
            join cliente c on c.id = d.cliente_id and c.negocio_id = d.negocio_id
            where ihr.hoja_ruta_id = $1
            order by ihr.orden_parada asc
            `,
            [hojaId],
          );

          const paradas: ItemHojaRutaDetalle[] = resParadas.rows.map((p) => ({
            id: p.id,
            despachoId: p.despacho_id,
            despachoNumero: p.despacho_numero,
            clienteNombre: p.cliente_nombre,
            direccionDestino: p.direccion_destino,
            localidad: p.localidad,
            contactoNombre: p.contacto_nombre,
            contactoTelefono: p.contacto_telefono,
            ordenParada: p.orden_parada,
            estadoParada: p.estado_parada,
            entregadoEn: p.entregado_en,
            observacionesEntrega: p.observaciones_entrega,
          }));

          const paradasEntregadas = paradas.filter(
            (p) => p.estadoParada === 'entregado',
          ).length;

          return {
            id: cab.id,
            numero: cab.numero,
            fechaSalida: cab.fecha_salida,
            fleteroNombre: cab.fletero_nombre,
            fleteroTelefono: cab.fletero_telefono,
            vehiculoPatente: cab.vehiculo_patente,
            estado: cab.estado,
            observaciones: cab.observaciones,
            creadoPor: cab.creado_por,
            creadoEn: cab.creado_en,
            cerradaEn: cab.cerrada_en,
            totalParadas: paradas.length,
            paradasEntregadas,
            paradas,
          };
        },
      );

      if (!detalle) {
        return await reply.code(404).send({ error: 'Hoja de ruta no encontrada' });
      }

      return await reply.send(detalle);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Crear nueva Hoja de Ruta agrupando despachos
  app.post('/logistica/hojas-ruta', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const body = crearHojaRutaSchema.parse(request.body);
      const usuarioNombre = claims.email ?? 'Operador';

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Generar correlativo HDR-XXXX
          const maxNumRes = await client.query<{ max_num: number }>(
            `
            select coalesce(
              max(
                case
                  when numero ~ '^HDR-[0-9]+$' then substring(numero from 5)::integer
                  else 0
                end
              ),
              0
            ) as max_num
            from hoja_ruta_fletero
            `,
          );
          const siguienteNum = (maxNumRes.rows[0]?.max_num ?? 0) + 1;
          const numeroHoja = `HDR-${String(siguienteNum).padStart(4, '0')}`;

          const hojaId = randomUUID();
          await client.query(
            `
            insert into hoja_ruta_fletero (
              id, negocio_id, numero, fecha_salida, fletero_nombre,
              fletero_telefono, vehiculo_patente, estado, observaciones, creado_por
            ) values ($1, $2, $3, coalesce($4::date, current_date), $5, $6, $7, 'en_preparacion', $8, $9)
            `,
            [
              hojaId,
              claims.negocioId,
              numeroHoja,
              body.fechaSalida ?? null,
              body.fleteroNombre,
              body.fleteroTelefono ?? null,
              body.vehiculoPatente ?? null,
              body.observaciones ?? null,
              usuarioNombre,
            ],
          );

          // Asignar paradas y cambiar estado de los despachos a 'en_camino'
          let orden = 1;
          for (const despId of body.despachosIds) {
            await client.query(
              `
              insert into item_hoja_ruta (
                id, negocio_id, hoja_ruta_id, despacho_id, orden_parada, estado_parada
              ) values ($1, $2, $3, $4, $5, 'pendiente')
              `,
              [randomUUID(), claims.negocioId, hojaId, despId, orden],
            );

            await client.query(
              `
              update despacho_envio
              set estado = 'en_camino'
              where id = $1 and estado = 'pendiente'
              `,
              [despId],
            );

            orden++;
          }

          // Registrar auditoría
          await registrarAuditoria(client, {
            negocioId: claims.negocioId,
            usuarioId: claims.usuarioId,
            usuarioEmail: claims.email ?? null,
            rol: claims.rol,
            accion: 'crear_acopio', // Reusamos auditoría comercial
            entidad: 'articulo',
            detalles: {
              modulo: 'logistica_hoja_ruta',
              numero: numeroHoja,
              fletero: body.fleteroNombre,
              totalParadas: body.despachosIds.length,
            },
          });

          return { id: hojaId, numero: numeroHoja };
        },
      );

      return await reply.code(201).send({
        ok: true,
        id: resultado.id,
        numero: resultado.numero,
        mensaje: `Hoja de ruta ${resultado.numero} creada con éxito.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Cambiar estado de una parada individual en la hoja de ruta
  app.put('/logistica/hojas-ruta/:id/paradas/:itemId', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { id: string; itemId: string };
      const hojaId = uuidSchema.parse(params.id);
      const itemId = uuidSchema.parse(params.itemId);
      const body = registrarEntregaParadaSchema.parse(request.body);

      await withTenantTransaction(pool, claims.negocioId, async ({ client }) => {
        const itemRes = await client.query<{ despacho_id: string }>(
          'select despacho_id from item_hoja_ruta where id = $1 and hoja_ruta_id = $2',
          [itemId, hojaId],
        );
        const despachoId = itemRes.rows[0]?.despacho_id;
        if (!despachoId) {
          throw new Error('Parada de hoja de ruta no encontrada');
        }

        const ahoraSql =
          body.estadoParada === 'entregado' ? 'clock_timestamp()' : 'null';

        await client.query(
          `
          update item_hoja_ruta
          set estado_parada = $1,
              entregado_en = ${ahoraSql},
              observaciones_entrega = $2
          where id = $3
          `,
          [body.estadoParada, body.observacionesEntrega ?? null, itemId],
        );

        // Actualizar el despacho
        const nuevoEstadoDespacho: EstadoDespacho =
          body.estadoParada === 'entregado' ? 'entregado' : 'fallido';

        await client.query(
          `
          update despacho_envio
          set estado = $1,
              entregado_en = ${ahoraSql},
              motivo_fallo = $2
          where id = $3
          `,
          [nuevoEstadoDespacho, body.observacionesEntrega ?? null, despachoId],
        );
      });

      return await reply.send({
        ok: true,
        mensaje: `Parada registrada como '${body.estadoParada}'.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 8. Cambiar estado de la Hoja de Ruta (en_viaje / finalizada)
  app.put('/logistica/hojas-ruta/:id/estado', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const params = request.params as { id: string };
      const hojaId = uuidSchema.parse(params.id);
      const body = cambiarEstadoHojaRutaSchema.parse(request.body);

      await withTenantTransaction(pool, claims.negocioId, async ({ client }) => {
        const cerradaSql =
          body.estado === 'finalizada' ? 'clock_timestamp()' : 'null';

        await client.query(
          `
          update hoja_ruta_fletero
          set estado = $1,
              cerrada_en = ${cerradaSql}
          where id = $2
          `,
          [body.estado, hojaId],
        );
      });

      return await reply.send({
        ok: true,
        mensaje: `Estado de la hoja de ruta actualizado a '${body.estado}'.`,
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
