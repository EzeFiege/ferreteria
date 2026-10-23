import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import {
  aCentavos,
  deCentavos,
  guardarCategoriaSchema,
  guardarMedioPagoSchema,
  cambiarPasswordAdminSchema,
  guardarDatosEmpresaSchema,
  guardarRubroSchema,
  guardarUsuarioAdminSchema,
  uuidSchema,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import { hashPassword } from '../services/password.js';
import { categoria, medioPago, rubro } from '../db/schema.js';

export interface ConfiguracionRoutesOptions {
  pool: pg.Pool;
  verifyToken?: TokenVerifier | undefined;
}

function normalizarPct(pct: string): string {
  return deCentavos(aCentavos(pct));
}

function handleConfigError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof AuthError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: 'Datos de configuración inválidos',
      detalles: err.issues,
    });
  }
  request.log.error(
    { err, alerta: true, modulo: 'configuracion' },
    'Error inesperado en ruta de configuración',
  );
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

export function registerConfiguracionRoutes(
  app: FastifyInstance,
  options: ConfiguracionRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Healthcheck de readiness para monitoreo y alertas en producción (Railway / Cloud Run)
  app.get('/health/ready', async (request, reply) => {
    const client = await pool.connect().catch((err: unknown) => {
      request.log.error(
        { err, alerta: true, tipoAlerta: 'db_conexion_caida' },
        'ALERTA: No se pudo conectar a PostgreSQL en /health/ready',
      );
      return null;
    });

    if (client === null) {
      return await reply.code(503).send({
        status: 'unhealthy',
        db: 'down',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      await client.query('begin');
      await client.query('set local role app_user');
      const roleRes = await client.query<{ current_user: string }>(
        'select current_user',
      );
      await client.query('commit');

      return await reply.code(200).send({
        status: 'ready',
        db: 'ok',
        dbRole: roleRes.rows[0]?.current_user ?? 'app_user',
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      await client.query('rollback').catch(() => {});
      request.log.error(
        { err, alerta: true, tipoAlerta: 'db_query_fallida' },
        'ALERTA: Falló la verificación de app_user en /health/ready',
      );
      return await reply.code(503).send({
        status: 'unhealthy',
        db: 'error',
        timestamp: new Date().toISOString(),
      });
    } finally {
      client.release();
    }
  });

  // 2. Consultar todos los catálogos del negocio actual
  app.get('/configuracion/catalogos', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const medios = await db
            .select()
            .from(medioPago)
            .orderBy(asc(medioPago.nombre));
          const rubros = await db
            .select()
            .from(rubro)
            .orderBy(asc(rubro.nombre));
          const categorias = await db
            .select()
            .from(categoria)
            .orderBy(asc(categoria.tipo), asc(categoria.nombre));

          return {
            mediosPago: medios.map((m) => ({
              ...m,
              comisionPct: normalizarPct(m.comisionPct),
            })),
            rubros,
            categorias,
          };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // 3. Crear o actualizar un medio de pago real (días de acreditación y comisión) — solo rol dueno
  app.post('/configuracion/medios-pago', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarMedioPagoSchema.parse(request.body);
      const comisionNormalizada = normalizarPct(body.comisionPct);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          if (body.id !== undefined) {
            const [actualizado] = await db
              .update(medioPago)
              .set({
                nombre: body.nombre,
                esEfectivo: body.esEfectivo,
                diasAcreditacion: body.diasAcreditacion,
                comisionPct: comisionNormalizada,
                activo: body.activo ?? true,
              })
              .where(eq(medioPago.id, body.id))
              .returning();

            if (actualizado === undefined) {
              return null;
            }
            return {
              ...actualizado,
              comisionPct: normalizarPct(actualizado.comisionPct),
            };
          }

          const res = await client.query<{
            id: string;
            negocio_id: string;
            nombre: string;
            es_efectivo: boolean;
            dias_acreditacion: number;
            comision_pct: string;
            activo: boolean;
          }>(
            `
            insert into medio_pago (negocio_id, nombre, es_efectivo, dias_acreditacion, comision_pct, activo)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (negocio_id, nombre) do update
              set es_efectivo = excluded.es_efectivo,
                  dias_acreditacion = excluded.dias_acreditacion,
                  comision_pct = excluded.comision_pct,
                  activo = excluded.activo
            returning id, negocio_id, nombre, es_efectivo, dias_acreditacion, comision_pct, activo
            `,
            [
              claims.negocioId,
              body.nombre,
              body.esEfectivo,
              body.diasAcreditacion,
              comisionNormalizada,
              body.activo ?? true,
            ],
          );

          const fila = res.rows[0];
          if (fila === undefined) {
            return null;
          }

          return {
            id: fila.id,
            negocioId: fila.negocio_id,
            nombre: fila.nombre,
            esEfectivo: fila.es_efectivo,
            diasAcreditacion: fila.dias_acreditacion,
            comisionPct: normalizarPct(fila.comision_pct),
            activo: fila.activo,
          };
        },
      );

      if (resultado === null) {
        return await reply
          .code(404)
          .send({ error: 'Medio de pago no encontrado' });
      }

      request.log.info(
        {
          accion: 'configurar_medio_pago',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
          medioPagoId: resultado.id,
          nombre: resultado.nombre,
          diasAcreditacion: resultado.diasAcreditacion,
          comisionPct: resultado.comisionPct,
        },
        'Medio de pago configurado por dueño',
      );

      return await reply.code(200).send({ medioPago: resultado });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // 4. Crear o actualizar un rubro real de la ferretería — solo rol dueno
  app.post('/configuracion/rubros', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarRubroSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          if (body.id !== undefined) {
            const [actualizado] = await db
              .update(rubro)
              .set({ nombre: body.nombre })
              .where(eq(rubro.id, body.id))
              .returning();
            return actualizado ?? null;
          }

          const res = await client.query<{
            id: string;
            negocio_id: string;
            nombre: string;
          }>(
            `
            insert into rubro (negocio_id, nombre)
            values ($1, $2)
            on conflict (negocio_id, nombre) do update
              set nombre = excluded.nombre
            returning id, negocio_id, nombre
            `,
            [claims.negocioId, body.nombre],
          );

          const fila = res.rows[0];
          if (fila === undefined) {
            return null;
          }

          return {
            id: fila.id,
            negocioId: fila.negocio_id,
            nombre: fila.nombre,
          };
        },
      );

      if (resultado === null) {
        return await reply.code(404).send({ error: 'Rubro no encontrado' });
      }

      request.log.info(
        {
          accion: 'configurar_rubro',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
          rubroId: resultado.id,
          nombre: resultado.nombre,
        },
        'Rubro configurado por dueño',
      );

      return await reply.code(200).send({ rubro: resultado });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // 5. Crear o actualizar una categoría real de ingresos/egresos — solo rol dueno
  app.post('/configuracion/categorias', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarCategoriaSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client, db }) => {
          if (body.id !== undefined) {
            const [actualizada] = await db
              .update(categoria)
              .set({ nombre: body.nombre, tipo: body.tipo })
              .where(eq(categoria.id, body.id))
              .returning();
            return actualizada ?? null;
          }

          const res = await client.query<{
            id: string;
            negocio_id: string;
            nombre: string;
            tipo: 'ingreso' | 'egreso';
          }>(
            `
            insert into categoria (negocio_id, nombre, tipo)
            values ($1, $2, $3)
            on conflict (negocio_id, nombre, tipo) do update
              set nombre = excluded.nombre
            returning id, negocio_id, nombre, tipo
            `,
            [claims.negocioId, body.nombre, body.tipo],
          );

          const fila = res.rows[0];
          if (fila === undefined) {
            return null;
          }

          return {
            id: fila.id,
            negocioId: fila.negocio_id,
            nombre: fila.nombre,
            tipo: fila.tipo,
          };
        },
      );

      if (resultado === null) {
        return await reply.code(404).send({ error: 'Categoría no encontrada' });
      }

      request.log.info(
        {
          accion: 'configurar_categoria',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
          categoriaId: resultado.id,
          nombre: resultado.nombre,
          tipo: resultado.tipo,
        },
        'Categoría configurada por dueño',
      );

      return await reply.code(200).send({ categoria: resultado });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // --------------------------------------------------------------------------
  // Fase 15: Configuración de Empresa (Branding, Datos Fiscales y Tickets)
  // --------------------------------------------------------------------------

  app.get('/configuracion/empresa', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado', 'cajero']);

      const empresa = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query<{
            id: string;
            nombre: string;
            razon_social: string | null;
            cuit: string | null;
            condicion_iva: string;
            iibb: string | null;
            inicio_actividades: string | null;
            domicilio_comercial: string | null;
            telefono: string | null;
            email: string | null;
            logo_url: string | null;
            leyenda_ticket: string | null;
          }>(
            `
            select id, nombre, razon_social, cuit, condicion_iva, iibb,
                   to_char(inicio_actividades, 'YYYY-MM-DD') as inicio_actividades,
                   domicilio_comercial, telefono, email, logo_url, leyenda_ticket
            from negocio
            where id = $1
            `,
            [claims.negocioId],
          );

          const fila = res.rows[0];
          if (!fila) return null;

          return {
            id: fila.id,
            nombre: fila.nombre,
            razonSocial: fila.razon_social,
            cuit: fila.cuit,
            condicionIva: fila.condicion_iva,
            iibb: fila.iibb,
            inicioActividades: fila.inicio_actividades,
            domicilioComercial: fila.domicilio_comercial,
            telefono: fila.telefono,
            email: fila.email,
            logoUrl: fila.logo_url,
            leyendaTicket: fila.leyenda_ticket,
          };
        },
      );

      if (!empresa) {
        return await reply.code(404).send({ error: 'Negocio no encontrado' });
      }

      return await reply.code(200).send({ empresa });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  app.put('/configuracion/empresa', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarDatosEmpresaSchema.parse(request.body);

      const empresaActualizada = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query<{
            id: string;
            nombre: string;
            razon_social: string | null;
            cuit: string | null;
            condicion_iva: string;
            iibb: string | null;
            inicio_actividades: string | null;
            domicilio_comercial: string | null;
            telefono: string | null;
            email: string | null;
            logo_url: string | null;
            leyenda_ticket: string | null;
          }>(
            `
            update negocio
            set nombre = $1,
                razon_social = $2,
                cuit = $3,
                condicion_iva = $4,
                iibb = $5,
                inicio_actividades = $6,
                domicilio_comercial = $7,
                telefono = $8,
                email = $9,
                logo_url = $10,
                leyenda_ticket = $11
            where id = $12
            returning id, nombre, razon_social, cuit, condicion_iva, iibb,
                      to_char(inicio_actividades, 'YYYY-MM-DD') as inicio_actividades,
                      domicilio_comercial, telefono, email, logo_url, leyenda_ticket
            `,
            [
              body.nombre,
              body.razonSocial ?? null,
              body.cuit ?? null,
              body.condicionIva,
              body.iibb ?? null,
              body.inicioActividades ? body.inicioActividades : null,
              body.domicilioComercial ?? null,
              body.telefono ?? null,
              body.email ?? null,
              body.logoUrl ?? null,
              body.leyendaTicket ?? null,
              claims.negocioId,
            ],
          );

          const fila = res.rows[0];
          if (!fila) return null;

          return {
            id: fila.id,
            nombre: fila.nombre,
            razonSocial: fila.razon_social,
            cuit: fila.cuit,
            condicionIva: fila.condicion_iva,
            iibb: fila.iibb,
            inicioActividades: fila.inicio_actividades,
            domicilioComercial: fila.domicilio_comercial,
            telefono: fila.telefono,
            email: fila.email,
            logoUrl: fila.logo_url,
            leyendaTicket: fila.leyenda_ticket,
          };
        },
      );

      if (!empresaActualizada) {
        return await reply.code(404).send({ error: 'Negocio no encontrado' });
      }

      request.log.info(
        {
          accion: 'actualizar_empresa',
          usuarioId: claims.usuarioId,
          negocioId: claims.negocioId,
        },
        'Datos de empresa actualizados por dueño',
      );

      return await reply.code(200).send({ empresa: empresaActualizada });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  // --------------------------------------------------------------------------
  // Fase 15: Gestión de Usuarios y Accesos
  // --------------------------------------------------------------------------

  app.get('/configuracion/usuarios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno', 'encargado']);

      const usuarios = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query<{
            id: string;
            negocio_id: string;
            proveedor_uid: string;
            nombre: string;
            email: string | null;
            rol: 'dueno' | 'encargado' | 'cajero';
            activo: boolean;
            ultimo_ingreso: string | null;
          }>(
            `
            select id, negocio_id, proveedor_uid, nombre, email, rol, activo,
                   to_char(ultimo_ingreso, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ultimo_ingreso
            from usuario
            where negocio_id = $1
            order by nombre asc
            `,
            [claims.negocioId],
          );

          return res.rows.map((r: {
            id: string;
            negocio_id: string;
            proveedor_uid: string;
            nombre: string;
            email: string | null;
            rol: 'dueno' | 'encargado' | 'cajero';
            activo: boolean;
            ultimo_ingreso: string | null;
          }) => ({
            id: r.id,
            negocioId: r.negocio_id,
            proveedorUid: r.proveedor_uid,
            nombre: r.nombre,
            email: r.email,
            rol: r.rol,
            activo: r.activo,
            ultimoIngreso: r.ultimo_ingreso,
          }));
        },
      );

      return await reply.code(200).send({ usuarios });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  app.post('/configuracion/usuarios', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarUsuarioAdminSchema.parse(request.body);

      if (!body.password || body.password.trim().length === 0) {
        return await reply.code(400).send({
          error: 'La contraseña es obligatoria para nuevos usuarios',
        });
      }

      const passHash = hashPassword(body.password);
      const nuevoId = body.id ?? randomUUID();
      const proveedorUid = `local:${body.email.toLowerCase()}`;

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Verificar email duplicado en el mismo negocio
          const check = await client.query(
            `select id from usuario where negocio_id = $1 and lower(email) = lower($2)`,
            [claims.negocioId, body.email],
          );
          if (check.rowCount && check.rowCount > 0) {
            return { duplicado: true as const };
          }

          const insertRes = await client.query<{
            id: string;
            negocio_id: string;
            proveedor_uid: string;
            nombre: string;
            email: string | null;
            rol: 'dueno' | 'encargado' | 'cajero';
            activo: boolean;
            ultimo_ingreso: string | null;
          }>(
            `
            insert into usuario (id, negocio_id, proveedor_uid, nombre, email, rol, activo, password_hash)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            returning id, negocio_id, proveedor_uid, nombre, email, rol, activo,
                      to_char(ultimo_ingreso, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ultimo_ingreso
            `,
            [
              nuevoId,
              claims.negocioId,
              proveedorUid,
              body.nombre,
              body.email,
              body.rol,
              body.activo,
              passHash,
            ],
          );

          const r = insertRes.rows[0];
          if (!r) {
            throw new Error('No se pudo registrar el usuario');
          }
          return {
            usuario: {
              id: r.id,
              negocioId: r.negocio_id,
              proveedorUid: r.proveedor_uid,
              nombre: r.nombre,
              email: r.email,
              rol: r.rol,
              activo: r.activo,
              ultimoIngreso: r.ultimo_ingreso,
            },
          };
        },
      );

      if ('duplicado' in resultado) {
        return await reply.code(409).send({
          error: 'Ya existe un usuario registrado con ese correo electrónico',
        });
      }

      request.log.info(
        {
          accion: 'crear_usuario',
          usuarioCreadoId: resultado.usuario.id,
          negocioId: claims.negocioId,
          rol: resultado.usuario.rol,
        },
        'Usuario creado por dueño',
      );

      return await reply.code(201).send({ usuario: resultado.usuario });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  app.put('/configuracion/usuarios/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const params = request.params as { id: string };
      const usuarioId = uuidSchema.parse(params.id);
      const body = guardarUsuarioAdminSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          // Si el usuario edita su propio usuario
          if (claims.usuarioId === usuarioId) {
            if (!body.activo) {
              return { errorPropio: 'No podés desactivar tu propio usuario' };
            }
            if (body.rol !== 'dueno') {
              return { errorPropio: 'No podés quitarte el rol de dueño a vos mismo' };
            }
          }

          // Verificar email duplicado en otro usuario
          const check = await client.query(
            `select id from usuario where negocio_id = $1 and lower(email) = lower($2) and id <> $3`,
            [claims.negocioId, body.email, usuarioId],
          );
          if (check.rowCount && check.rowCount > 0) {
            return { duplicado: true as const };
          }

          let updateRes;
          if (body.password && body.password.trim().length > 0) {
            const passHash = hashPassword(body.password);
            updateRes = await client.query<{
              id: string;
              negocio_id: string;
              proveedor_uid: string;
              nombre: string;
              email: string | null;
              rol: 'dueno' | 'encargado' | 'cajero';
              activo: boolean;
              ultimo_ingreso: string | null;
            }>(
              `
              update usuario
              set nombre = $1,
                  email = $2,
                  rol = $3,
                  activo = $4,
                  password_hash = $5
              where id = $6 and negocio_id = $7
              returning id, negocio_id, proveedor_uid, nombre, email, rol, activo,
                        to_char(ultimo_ingreso, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ultimo_ingreso
              `,
              [body.nombre, body.email, body.rol, body.activo, passHash, usuarioId, claims.negocioId],
            );
          } else {
            updateRes = await client.query<{
              id: string;
              negocio_id: string;
              proveedor_uid: string;
              nombre: string;
              email: string | null;
              rol: 'dueno' | 'encargado' | 'cajero';
              activo: boolean;
              ultimo_ingreso: string | null;
            }>(
              `
              update usuario
              set nombre = $1,
                  email = $2,
                  rol = $3,
                  activo = $4
              where id = $5 and negocio_id = $6
              returning id, negocio_id, proveedor_uid, nombre, email, rol, activo,
                        to_char(ultimo_ingreso, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ultimo_ingreso
              `,
              [body.nombre, body.email, body.rol, body.activo, usuarioId, claims.negocioId],
            );
          }

          const r = updateRes.rows[0];
          if (!r) return null;

          return {
            usuario: {
              id: r.id,
              negocioId: r.negocio_id,
              proveedorUid: r.proveedor_uid,
              nombre: r.nombre,
              email: r.email,
              rol: r.rol,
              activo: r.activo,
              ultimoIngreso: r.ultimo_ingreso,
            },
          };
        },
      );

      if (resultado === null) {
        return await reply.code(404).send({ error: 'Usuario no encontrado' });
      }
      if ('errorPropio' in resultado) {
        return await reply.code(400).send({ error: resultado.errorPropio });
      }
      if ('duplicado' in resultado) {
        return await reply.code(409).send({
          error: 'Ya existe otro usuario registrado con ese correo electrónico',
        });
      }

      request.log.info(
        {
          accion: 'actualizar_usuario',
          usuarioEditadoId: resultado.usuario.id,
          negocioId: claims.negocioId,
          rol: resultado.usuario.rol,
        },
        'Usuario modificado por dueño',
      );

      return await reply.code(200).send({ usuario: resultado.usuario });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

  app.post('/configuracion/usuarios/:id/password', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const params = request.params as { id: string };
      const usuarioId = uuidSchema.parse(params.id);
      const body = cambiarPasswordAdminSchema.parse(request.body);

      const passHash = hashPassword(body.password);

      const actualizado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ client }) => {
          const res = await client.query(
            `
            update usuario
            set password_hash = $1
            where id = $2 and negocio_id = $3
            returning id
            `,
            [passHash, usuarioId, claims.negocioId],
          );
          return (res.rowCount ?? 0) > 0;
        },
      );

      if (!actualizado) {
        return await reply.code(404).send({ error: 'Usuario no encontrado' });
      }

      request.log.info(
        {
          accion: 'cambiar_password_usuario',
          usuarioEditadoId: usuarioId,
          negocioId: claims.negocioId,
        },
        'Contraseña de usuario restablecida por dueño',
      );

      return await reply.code(200).send({
        ok: true,
        mensaje: 'Contraseña actualizada correctamente',
      });
    } catch (err: unknown) {
      return handleConfigError(err, request, reply);
    }
  });

}
