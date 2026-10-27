import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, max } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  emitirComprobanteFiscalSchema,
  guardarConfiguracionAfipSchema,
  guardarPuntoVentaSchema,
  uuidSchema,
  type ComprobanteFiscalDetalle,
  type CondicionIva,
  type EntornoAfip,
  type EstadoAfipResponse,
  type TipoComprobanteFiscal,
} from '@ferreteria/shared';
import {
  assertRoles,
  authenticateRequest,
  AuthError,
  type TokenVerifier,
} from '../auth.js';
import { withTenantTransaction } from '../db/context.js';
import {
  consultarEstadoServidoresAfip,
  solicitarAutorizacionAfip,
} from '../services/afip-wsfe-service.js';
import {
  comprobanteFiscal,
  itemComprobanteFiscal,
  negocio,
  puntoVenta,
} from '../db/schema.js';

export interface FacturacionRoutesOptions extends FastifyPluginOptions {
  pool: Pool;
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
      error: 'Datos inválidos',
      detalles: err.issues,
    });
  }
  request.log.error({ err, modulo: 'facturacion' }, 'Error en ruta de facturación fiscal');
  return reply.code(500).send({ error: 'Error interno del servidor' });
}

// Mapeo oficial de códigos AFIP
const CODIGOS_AFIP: Record<TipoComprobanteFiscal, number> = {
  factura_a: 1,
  nota_debito_a: 2,
  nota_credito_a: 3,
  factura_b: 6,
  nota_debito_b: 7,
  nota_credito_b: 8,
  factura_c: 11,
  nota_debito_c: 12,
  nota_credito_c: 13,
};

// Generador de URL oficial QR ARCA (RG 4291/4892)
export function generarQrArca(datos: {
  fecha: string;
  cuitEmisor: number;
  puntoVenta: number;
  tipoComprobante: number;
  numeroComprobante: number;
  importe: number;
  tipoDocReceptor: number;
  nroDocReceptor: number;
  cae: number;
}): string {
  const payload = {
    ver: 1,
    fecha: datos.fecha,
    cuit: datos.cuitEmisor,
    ptoVta: datos.puntoVenta,
    tipoCmp: datos.tipoComprobante,
    nroCmp: datos.numeroComprobante,
    importe: datos.importe,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: datos.tipoDocReceptor,
    nroDocRec: datos.nroDocReceptor,
    tipoCodAut: 'E',
    codAut: datos.cae,
  };
  const jsonStr = JSON.stringify(payload);
  const base64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

export function registerFacturacionRoutes(
  app: FastifyInstance,
  options: FacturacionRoutesOptions,
): void {
  const { pool, verifyToken } = options;

  // 1. Listar puntos de venta
  app.get('/facturacion/puntos-venta', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          return await db
            .select()
            .from(puntoVenta)
            .where(eq(puntoVenta.negocioId, claims.negocioId))
            .orderBy(puntoVenta.numero);
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 2. Crear o actualizar punto de venta (dueno)
  app.post('/facturacion/puntos-venta', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarPuntoVentaSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [existente] = await db
            .select()
            .from(puntoVenta)
            .where(
              and(
                eq(puntoVenta.negocioId, claims.negocioId),
                eq(puntoVenta.numero, body.numero),
              ),
            );

          if (existente) {
            const [actualizado] = await db
              .update(puntoVenta)
              .set({
                nombre: body.nombre,
                tipo: body.tipo,
                habilitado: body.habilitado,
                cuitEmisor: body.cuitEmisor ?? null,
                inicioActividades: body.inicioActividades ?? null,
                iibb: body.iibb ?? null,
                notas: body.notas ?? null,
                actualizadoEn: new Date(),
              })
              .where(
                and(
                  eq(puntoVenta.id, existente.id),
                  eq(puntoVenta.negocioId, claims.negocioId),
                ),
              )
              .returning();
            return actualizado;
          }

          const [creado] = await db
            .insert(puntoVenta)
            .values({
              ...(body.id ? { id: body.id } : {}),
              negocioId: claims.negocioId,
              numero: body.numero,
              nombre: body.nombre,
              tipo: body.tipo,
              habilitado: body.habilitado,
              cuitEmisor: body.cuitEmisor ?? null,
              inicioActividades: body.inicioActividades ?? null,
              iibb: body.iibb ?? null,
              notas: body.notas ?? null,
            })
            .returning();
          return creado;
        },
      );

      return await reply.code(201).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 3. Listar comprobantes fiscales emitidos
  app.get('/facturacion/comprobantes', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const filas = await db
            .select()
            .from(comprobanteFiscal)
            .where(eq(comprobanteFiscal.negocioId, claims.negocioId))
            .orderBy(desc(comprobanteFiscal.creadoEn))
            .limit(100);

          return filas.map((f) => ({
            id: f.id,
            puntoVentaNumero: f.numeroPuntoVenta,
            tipoComprobante: f.tipoComprobante,
            numeroComprobante: f.numeroComprobante,
            codigoAfip: f.codigoAfip,
            fechaEmision: f.fechaEmision,
            ventaId: f.ventaId,
            cuitCliente: f.cuitCliente,
            razonSocialCliente: f.razonSocialCliente,
            condicionIvaCliente: f.condicionIvaCliente,
            subtotalNetoGravado: f.subtotalNetoGravado,
            subtotalIva21: f.subtotalIva21,
            subtotalIva105: f.subtotalIva105,
            subtotalIva27: f.subtotalIva27,
            subtotalExento: f.subtotalExento,
            total: f.total,
            estado: f.estado,
            cae: f.cae,
            vencimientoCae: f.vencimientoCae,
            codigoQrArca: f.codigoQrArca,
            creadoEn: f.creadoEn.toISOString(),
          }));
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 4. Emitir Comprobante Fiscal Electrónico (Factura A, B, C)
  app.post('/facturacion/emitir', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const body = emitirComprobanteFiscalSchema.parse(request.body);

      const nuevoComprobante = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db, client }) => {
          // Bloquear concurrentemente el punto de venta para asignar correlatividad atómica
          const [pv] = await db
            .select()
            .from(puntoVenta)
            .where(
              and(
                eq(puntoVenta.negocioId, claims.negocioId),
                eq(puntoVenta.numero, body.puntoVentaNumero),
              ),
            );

          if (!pv || !pv.habilitado) {
            throw new AuthError('Punto de venta no habilitado o no encontrado', 400);
          }

          // Bloqueo a nivel fila en PostgreSQL para correlatividad estricta sin saltos
          await client.query('select pg_advisory_xact_lock(hashtext($1))', [
            `pv_${claims.negocioId}_${body.puntoVentaNumero}_${body.tipoComprobante}`,
          ]);

          // Calcular siguiente correlativo
          const [maxComp] = await db
            .select({ maximo: max(comprobanteFiscal.numeroComprobante) })
            .from(comprobanteFiscal)
            .where(
              and(
                eq(comprobanteFiscal.negocioId, claims.negocioId),
                eq(comprobanteFiscal.numeroPuntoVenta, body.puntoVentaNumero),
                eq(comprobanteFiscal.tipoComprobante, body.tipoComprobante),
              ),
            );

          const proximoNumero = (maxComp?.maximo ?? 0) + 1;
          const codigoAfip = CODIGOS_AFIP[body.tipoComprobante];

          // Cálculo impositivo según alícuota
          const totalNum = parseFloat(body.total);
          let netoGravado = '0.00';
          let iva21 = '0.00';
          let iva105 = '0.00';
          let iva27 = '0.00';
          let exento = '0.00';

          if (body.alicuotaIva === '21') {
            const neto = totalNum / 1.21;
            const iva = totalNum - neto;
            netoGravado = neto.toFixed(2);
            iva21 = iva.toFixed(2);
          } else if (body.alicuotaIva === '10.5') {
            const neto = totalNum / 1.105;
            const iva = totalNum - neto;
            netoGravado = neto.toFixed(2);
            iva105 = iva.toFixed(2);
          } else if (body.alicuotaIva === '27') {
            const neto = totalNum / 1.27;
            const iva = totalNum - neto;
            netoGravado = neto.toFixed(2);
            iva27 = iva.toFixed(2);
          } else {
            exento = totalNum.toFixed(2);
          }

          // Autorización con ARCA / AFIP (WSFEv1 / CAE o CAI de contingencia)
          let cae: string | null = null;
          let vencimientoCae: string | null = null;
          let estado: 'autorizado' | 'contingencia_offline' = 'autorizado';
          let resultadoAfip = 'A';
          let codigoQr: string | null = null;

          if (body.enContingenciaOffline) {
            estado = 'contingencia_offline';
            resultadoAfip = 'P'; // Pendiente de sincronización
          } else {
            const docReceptorNum = parseInt(
              body.cuitCliente?.replace(/\D/g, '') || '0',
              10,
            );
            const tipoDocReceptor = docReceptorNum > 0 ? 80 : 99;

            const autAfip = await solicitarAutorizacionAfip({
              entorno: pv.notas?.includes('"entorno":"produccion"')
                ? 'produccion'
                : 'homologacion',
              cuitEmisor: pv.cuitEmisor ?? '30712345678',
              puntoVenta: body.puntoVentaNumero,
              tipoComprobanteAfip: codigoAfip,
              numeroComprobante: proximoNumero,
              fechaEmision: new Date().toISOString().slice(0, 10),
              importeTotal: totalNum,
              importeNetoGravado: parseFloat(netoGravado),
              importeIva:
                parseFloat(iva21) + parseFloat(iva105) + parseFloat(iva27),
              importeExento: parseFloat(exento),
              tipoDocReceptor,
              nroDocReceptor: docReceptorNum,
              esContingenciaCai: pv.tipo === 'manual_contingencia',
              caiContingencia: pv.notas?.match(/"cai":"([^"]+)"/)?.[1],
              vencimientoCai: pv.notas?.match(/"vencimientoCai":"([^"]+)"/)?.[1],
            });

            cae = autAfip.cae ?? null;
            vencimientoCae = autAfip.vencimientoCae ?? null;
            resultadoAfip = autAfip.resultado;
            codigoQr = autAfip.codigoQrArca ?? null;
          }

          const [creado] = await db
            .insert(comprobanteFiscal)
            .values({
              ...(body.id ? { id: body.id } : {}),
              negocioId: claims.negocioId,
              puntoVentaId: pv.id,
              numeroPuntoVenta: body.puntoVentaNumero,
              tipoComprobante: body.tipoComprobante,
              codigoAfip,
              numeroComprobante: proximoNumero,
              fechaEmision: new Date().toISOString().slice(0, 10),
              ventaId: body.ventaId ?? null,
              clienteId: body.clienteId ?? null,
              cuitCliente: body.cuitCliente ?? null,
              tipoDocumentoAfip: body.cuitCliente ? 80 : 99,
              razonSocialCliente: body.razonSocialCliente.trim(),
              condicionIvaCliente: body.condicionIvaCliente,
              domicilioCliente: body.domicilioCliente?.trim() ?? null,
              subtotalNetoGravado: netoGravado,
              subtotalIva21: iva21,
              subtotalIva105: iva105,
              subtotalIva27: iva27,
              subtotalExento: exento,
              subtotalNoGravado: '0.00',
              total: body.total,
              estado,
              cae,
              vencimientoCae,
              codigoQrArca: codigoQr,
              resultadoAfip,
              creadoPor: claims.usuarioId,
            })
            .returning();

          if (!creado) {
            throw new Error('No se pudo registrar el comprobante fiscal.');
          }

          let itemsInsertados: (typeof itemComprobanteFiscal.$inferSelect)[] = [];
          if (body.items && body.items.length > 0) {
            itemsInsertados = await db
              .insert(itemComprobanteFiscal)
              .values(
                body.items.map((it) => ({
                  ...(it.id ? { id: it.id } : {}),
                  negocioId: claims.negocioId,
                  comprobanteId: creado.id,
                  productoId: it.productoId ?? null,
                  codigo: it.codigo ?? null,
                  descripcion: it.descripcion,
                  unidad: it.unidad,
                  cantidad: it.cantidad,
                  precioUnitario: it.precioUnitario,
                  alicuotaIva: it.alicuotaIva,
                  subtotal: it.subtotal,
                })),
              )
              .returning();
          }

          return { comprobante: creado, items: itemsInsertados };
        },
      );

      const detalle: ComprobanteFiscalDetalle = {
        id: nuevoComprobante.comprobante.id,
        puntoVentaNumero: nuevoComprobante.comprobante.numeroPuntoVenta,
        tipoComprobante: nuevoComprobante.comprobante.tipoComprobante,
        numeroComprobante: nuevoComprobante.comprobante.numeroComprobante,
        codigoAfip: nuevoComprobante.comprobante.codigoAfip,
        fechaEmision: nuevoComprobante.comprobante.fechaEmision,
        ventaId: nuevoComprobante.comprobante.ventaId,
        cuitCliente: nuevoComprobante.comprobante.cuitCliente,
        razonSocialCliente: nuevoComprobante.comprobante.razonSocialCliente,
        condicionIvaCliente: nuevoComprobante.comprobante.condicionIvaCliente as CondicionIva,
        subtotalNetoGravado: nuevoComprobante.comprobante.subtotalNetoGravado,
        subtotalIva21: nuevoComprobante.comprobante.subtotalIva21,
        subtotalIva105: nuevoComprobante.comprobante.subtotalIva105,
        subtotalIva27: nuevoComprobante.comprobante.subtotalIva27,
        subtotalExento: nuevoComprobante.comprobante.subtotalExento,
        total: nuevoComprobante.comprobante.total,
        estado: nuevoComprobante.comprobante.estado,
        cae: nuevoComprobante.comprobante.cae,
        vencimientoCae: nuevoComprobante.comprobante.vencimientoCae,
        codigoQrArca: nuevoComprobante.comprobante.codigoQrArca,
        creadoEn: nuevoComprobante.comprobante.creadoEn.toISOString(),
        items: nuevoComprobante.items.map((it) => ({
          id: it.id,
          comprobanteId: it.comprobanteId,
          productoId: it.productoId,
          codigo: it.codigo,
          descripcion: it.descripcion,
          unidad: it.unidad,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          alicuotaIva: it.alicuotaIva,
          subtotal: it.subtotal,
          creadoEn: it.creadoEn.toISOString(),
        })),
      };

      return await reply.code(201).send(detalle);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 5. Obtener comprobante fiscal por ID con detalle para impresión de ticket o factura
  app.get('/facturacion/comprobantes/:id', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['cajero', 'encargado', 'dueno']);

      const params = request.params as { id: string };
      const compId = uuidSchema.parse(params.id);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [f] = await db
            .select()
            .from(comprobanteFiscal)
            .where(
              and(
                eq(comprobanteFiscal.id, compId),
                eq(comprobanteFiscal.negocioId, claims.negocioId),
              ),
            );

          if (!f) return null;

          const items = await db
            .select()
            .from(itemComprobanteFiscal)
            .where(
              and(
                eq(itemComprobanteFiscal.comprobanteId, compId),
                eq(itemComprobanteFiscal.negocioId, claims.negocioId),
              ),
            );

          return {
            id: f.id,
            puntoVentaNumero: f.numeroPuntoVenta,
            tipoComprobante: f.tipoComprobante,
            numeroComprobante: f.numeroComprobante,
            codigoAfip: f.codigoAfip,
            fechaEmision: f.fechaEmision,
            ventaId: f.ventaId,
            cuitCliente: f.cuitCliente,
            razonSocialCliente: f.razonSocialCliente,
            condicionIvaCliente: f.condicionIvaCliente,
            domicilioCliente: f.domicilioCliente,
            subtotalNetoGravado: f.subtotalNetoGravado,
            subtotalIva21: f.subtotalIva21,
            subtotalIva105: f.subtotalIva105,
            subtotalIva27: f.subtotalIva27,
            subtotalExento: f.subtotalExento,
            total: f.total,
            estado: f.estado,
            cae: f.cae,
            vencimientoCae: f.vencimientoCae,
            codigoQrArca: f.codigoQrArca,
            creadoEn: f.creadoEn.toISOString(),
            items: items.map((it) => ({
              id: it.id,
              comprobanteId: it.comprobanteId,
              productoId: it.productoId,
              codigo: it.codigo,
              descripcion: it.descripcion,
              unidad: it.unidad,
              cantidad: it.cantidad,
              precioUnitario: it.precioUnitario,
              alicuotaIva: it.alicuotaIva,
              subtotal: it.subtotal,
              creadoEn: it.creadoEn.toISOString(),
            })),
          };
        },
      );

      if (!resultado) {
        return await reply.code(404).send({ message: 'Comprobante no encontrado' });
      }

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 6. Consultar estado y conectividad de AFIP / ARCA
  app.get('/facturacion/afip/estado', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const [n] = await db
            .select()
            .from(negocio)
            .where(eq(negocio.id, claims.negocioId));

          const puntos = await db
            .select()
            .from(puntoVenta)
            .where(eq(puntoVenta.negocioId, claims.negocioId))
            .limit(1);

          const pv = puntos[0];
          let entorno: EntornoAfip = 'homologacion';
          let tieneCertificado = false;
          let tieneClave = false;
          let caiContingencia: string | null = null;
          let vencimientoCai: string | null = null;

          if (pv?.notas) {
            try {
              const parsed = JSON.parse(pv.notas) as Record<string, unknown>;
              if (parsed['entorno'] === 'produccion') entorno = 'produccion';
              if (parsed['certificadoPem']) tieneCertificado = true;
              if (parsed['clavePrivadaPem']) tieneClave = true;
              if (typeof parsed['cai'] === 'string') caiContingencia = parsed['cai'];
              if (typeof parsed['vencimientoCai'] === 'string') vencimientoCai = parsed['vencimientoCai'];
            } catch {
              // Notas no es JSON
            }
          }

          const servidores = await consultarEstadoServidoresAfip(entorno);

          const respuesta: EstadoAfipResponse = {
            configurado: Boolean(pv?.cuitEmisor || n?.cuit),
            activo: pv?.habilitado ?? true,
            entorno,
            cuit: pv?.cuitEmisor ?? n?.cuit ?? null,
            puntoVenta: pv?.numero ?? 1,
            tieneCertificado,
            tieneClavePrivada: tieneClave,
            caiContingencia,
            vencimientoCai,
            servidores,
          };

          return respuesta;
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 7. Guardar o actualizar configuración de AFIP / ARCA
  app.post('/facturacion/afip/configuracion', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['dueno']);

      const body = guardarConfiguracionAfipSchema.parse(request.body);

      const resultado = await withTenantTransaction(
        pool,
        claims.negocioId,
        async ({ db }) => {
          const notasObj = {
            entorno: body.entorno,
            certificadoPem: body.certificadoPem ?? null,
            clavePrivadaPem: body.clavePrivadaPem ?? null,
            cai: body.caiContingencia ?? null,
            vencimientoCai: body.vencimientoCai ?? null,
          };

          const [pvExistente] = await db
            .select()
            .from(puntoVenta)
            .where(
              and(
                eq(puntoVenta.negocioId, claims.negocioId),
                eq(puntoVenta.numero, body.puntoVenta),
              ),
            );

          if (pvExistente) {
            await db
              .update(puntoVenta)
              .set({
                cuitEmisor: body.cuit,
                tipo: body.caiContingencia ? 'manual_contingencia' : 'electronico_arca',
                habilitado: body.activo,
                notas: JSON.stringify(notasObj),
                actualizadoEn: new Date(),
              })
              .where(eq(puntoVenta.id, pvExistente.id));
          } else {
            await db.insert(puntoVenta).values({
              negocioId: claims.negocioId,
              numero: body.puntoVenta,
              nombre: `Punto de Venta ${body.puntoVenta} (ARCA)`,
              tipo: body.caiContingencia ? 'manual_contingencia' : 'electronico_arca',
              habilitado: body.activo,
              cuitEmisor: body.cuit,
              notas: JSON.stringify(notasObj),
            });
          }

          // Actualizar CUIT en negocio si no estaba seteado
          await db
            .update(negocio)
            .set({ cuit: body.cuit })
            .where(eq(negocio.id, claims.negocioId));

          return { ok: true, mensaje: 'Configuración de AFIP / ARCA actualizada correctamente' };
        },
      );

      return await reply.code(200).send(resultado);
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });

  // 8. Test de conexión directo con servidores AFIP / ARCA
  app.post('/facturacion/afip/test-conexion', async (request, reply) => {
    try {
      const claims = await authenticateRequest(request, verifyToken);
      assertRoles(claims, ['encargado', 'dueno']);

      const body = request.body as { entorno?: EntornoAfip } | undefined;
      const entorno = body?.entorno ?? 'homologacion';

      const servidores = await consultarEstadoServidoresAfip(entorno);

      return await reply.code(200).send({
        ok: true,
        entorno,
        servidores,
        mensaje: 'Test de conectividad con servidores de AFIP / ARCA completado',
      });
    } catch (err: unknown) {
      return handleRouteError(err, request, reply);
    }
  });
}
