import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthToken } from '../auth.js';
import { runMigrations } from '../db/migrate.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from '../db/test-db.js';
import { buildServer } from '../server.js';
import type { ComprobanteFiscalDetalle } from '@ferreteria/shared';

const { Pool } = pg;

interface SeedBusiness {
  negocioId: string;
  cajaId: string;
  cajeroId: string;
  encargadoId: string;
  duenoId: string;
  tokenCajero: string;
  tokenEncargado: string;
  tokenDueno: string;
}

describe('Fase 6 — Facturación Fiscal Electrónica ARCA / AFIP', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;

  let negocioA: SeedBusiness;
  let negocioB: SeedBusiness;

  async function sembrarNegocioPrueba(nombre: string): Promise<SeedBusiness> {
    const negocioId = randomUUID();
    const sucursalId = randomUUID();
    const cajaId = randomUUID();
    const cajeroId = randomUUID();
    const encargadoId = randomUUID();
    const duenoId = randomUUID();

    await adminPool.query('insert into negocio (id, nombre) values ($1, $2)', [
      negocioId,
      nombre,
    ]);
    await adminPool.query(
      'insert into sucursal (id, negocio_id, nombre) values ($1, $2, $3)',
      [sucursalId, negocioId, 'Sucursal Central'],
    );
    await adminPool.query(
      'insert into caja (id, negocio_id, sucursal_id, nombre) values ($1, $2, $3, $4)',
      [cajaId, negocioId, sucursalId, 'Caja Mostrador'],
    );
    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, nombre, rol) values
        ($1, $4, $5, 'Cajero', 'cajero'),
        ($2, $4, $6, 'Encargado', 'encargado'),
        ($3, $4, $7, 'Dueño', 'dueno')`,
      [
        cajeroId,
        encargadoId,
        duenoId,
        negocioId,
        `uid-caj-${negocioId}`,
        `uid-enc-${negocioId}`,
        `uid-due-${negocioId}`,
      ],
    );

    await adminPool.query('select sembrar_negocio($1)', [negocioId]);

    return {
      negocioId,
      cajaId,
      cajeroId,
      encargadoId,
      duenoId,
      tokenCajero: createAuthToken({
        negocio_id: negocioId,
        usuario_id: cajeroId,
        rol: 'cajero',
      }),
      tokenEncargado: createAuthToken({
        negocio_id: negocioId,
        usuario_id: encargadoId,
        rol: 'encargado',
      }),
      tokenDueno: createAuthToken({
        negocio_id: negocioId,
        usuario_id: duenoId,
        rol: 'dueno',
      }),
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'app_test_password',
    });

    adminPool = new Pool({ connectionString: testDb.url });
    app = buildServer({ pool: adminPool });

    negocioA = await sembrarNegocioPrueba('Ferretería El Tornillo A');
    negocioB = await sembrarNegocioPrueba('Ferretería B');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Configura el punto de venta fiscal de ARCA', async () => {
    const resPV = await app.inject({
      method: 'POST',
      url: '/facturacion/puntos-venta',
      headers: { Authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        numero: 1,
        nombre: 'Caja Mostrador Central',
        tipo: 'electronico_arca',
        cuitEmisor: '30-71444555-9',
        iibb: '901-44555-1',
        inicioActividades: '2024-01-01',
      },
    });

    expect(resPV.statusCode).toBe(201);
    const pv = resPV.json<{ numero: number; cuitEmisor: string }>();
    expect(pv.numero).toBe(1);
    expect(pv.cuitEmisor).toBe('30-71444555-9');
  });

  it('2. Emite Factura B con CAE y QR fiscal de ARCA para Consumidor Final', async () => {
    const resFactura = await app.inject({
      method: 'POST',
      url: '/facturacion/emitir',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        puntoVentaNumero: 1,
        tipoComprobante: 'factura_b',
        razonSocialCliente: 'Consumidor Final',
        condicionIvaCliente: 'consumidor_final',
        alicuotaIva: '21',
        total: '12100.00',
      },
    });

    expect(resFactura.statusCode).toBe(201);
    const doc = resFactura.json<ComprobanteFiscalDetalle>();
    expect(doc.codigoAfip).toBe(6); // Factura B
    expect(doc.numeroComprobante).toBe(1); // Primer comprobante
    expect(doc.subtotalNetoGravado).toBe('10000.00');
    expect(doc.subtotalIva21).toBe('2100.00');
    expect(doc.total).toBe('12100.00');
    expect(doc.estado).toBe('autorizado');
    expect(doc.cae).toBeDefined();
    expect(doc.cae).toHaveLength(14);
    expect(doc.codigoQrArca).toContain('https://www.afip.gob.ar/fe/qr/?p=');
  });

  it('3. Emite Factura A con CUIT y desglose impositivo verificando correlatividad estricta', async () => {
    const resFacturaA = await app.inject({
      method: 'POST',
      url: '/facturacion/emitir',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        puntoVentaNumero: 1,
        tipoComprobante: 'factura_a',
        cuitCliente: '30-50000000-9',
        razonSocialCliente: 'Constructora del Plata SA',
        condicionIvaCliente: 'responsable_inscripto',
        domicilioCliente: 'Av. Corrientes 1234, CABA',
        alicuotaIva: '21',
        total: '24200.00',
      },
    });

    expect(resFacturaA.statusCode).toBe(201);
    const doc = resFacturaA.json<ComprobanteFiscalDetalle>();
    expect(doc.codigoAfip).toBe(1); // Factura A
    expect(doc.numeroComprobante).toBe(1);
    expect(doc.subtotalNetoGravado).toBe('20000.00');
    expect(doc.subtotalIva21).toBe('4200.00');
    expect(doc.total).toBe('24200.00');
    expect(doc.cuitCliente).toBe('30-50000000-9');

    // Emitir segunda Factura A para asegurar que el número incrementa a 2 sin saltos
    const resFacturaA2 = await app.inject({
      method: 'POST',
      url: '/facturacion/emitir',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        puntoVentaNumero: 1,
        tipoComprobante: 'factura_a',
        cuitCliente: '30-50000000-9',
        razonSocialCliente: 'Constructora del Plata SA',
        condicionIvaCliente: 'responsable_inscripto',
        alicuotaIva: '21',
        total: '12100.00',
      },
    });

    expect(resFacturaA2.statusCode).toBe(201);
    const doc2 = resFacturaA2.json<ComprobanteFiscalDetalle>();
    expect(doc2.numeroComprobante).toBe(2);
  });

  it('4. Bloquea modificación o eliminación de comprobantes autorizados con CAE (inmutabilidad fiscal)', async () => {
    const resComp = await adminPool.query<{ id: string }>(
      "select id from comprobante_fiscal where estado = 'autorizado' and negocio_id = $1 limit 1",
      [negocioA.negocioId],
    );
    const compId = resComp.rows[0]?.id;
    expect(compId).toBeDefined();

    // UPDATE bloqueado
    await expect(
      adminPool.query(
        'update comprobante_fiscal set total = 9999 where id = $1',
        [compId],
      ),
    ).rejects.toThrow(/inmutables/i);

    // DELETE bloqueado
    await expect(
      adminPool.query('delete from comprobante_fiscal where id = $1', [compId]),
    ).rejects.toThrow(/no pueden eliminarse/i);
  });

  it('5. Aislamiento multi-negocio con RLS en comprobantes fiscales', async () => {
    const resB = await app.inject({
      method: 'GET',
      url: '/facturacion/comprobantes',
      headers: { Authorization: `Bearer ${negocioB.tokenEncargado}` },
    });

    expect(resB.statusCode).toBe(200);
    const comprobantesB = resB.json<Array<{ id: string }>>();
    expect(comprobantesB.length).toBe(0);
  });

  it('6. Emite comprobante fiscal con detalle de ítems y lo recupera por ID', async () => {
    const resEmitir = await app.inject({
      method: 'POST',
      url: '/facturacion/emitir',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        puntoVentaNumero: 1,
        tipoComprobante: 'factura_b',
        cuitCliente: '20-12345678-9',
        razonSocialCliente: 'Pérez Juan',
        condicionIvaCliente: 'consumidor_final',
        alicuotaIva: '21',
        total: '10000.00',
        items: [
          {
            codigo: 'MART-01',
            descripcion: 'Martillo Galponero 500g',
            unidad: 'unidad',
            cantidad: '2.000',
            precioUnitario: '4000.00',
            alicuotaIva: '21',
            subtotal: '8000.00',
          },
          {
            codigo: 'CLAV-01',
            descripcion: 'Clavos punta parís 2 pulg',
            unidad: 'kilo',
            cantidad: '1.000',
            precioUnitario: '2000.00',
            alicuotaIva: '21',
            subtotal: '2000.00',
          },
        ],
      },
    });

    expect(resEmitir.statusCode).toBe(201);
    const factura = resEmitir.json<ComprobanteFiscalDetalle>();
    expect(factura.items).toBeDefined();
    expect(factura.items).toHaveLength(2);
    expect(factura.items?.[0]?.descripcion).toBe('Martillo Galponero 500g');
    expect(factura.items?.[0]?.cantidad).toBe('2.000');
    expect(factura.items?.[1]?.codigo).toBe('CLAV-01');

    // Recuperar por ID
    const resGet = await app.inject({
      method: 'GET',
      url: `/facturacion/comprobantes/${factura.id}`,
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resGet.statusCode).toBe(200);
    const facturaRecuperada = resGet.json<ComprobanteFiscalDetalle>();
    expect(facturaRecuperada.id).toBe(factura.id);
    expect(facturaRecuperada.items).toHaveLength(2);
    expect(facturaRecuperada.items?.[0]?.subtotal).toBe('8000.00');
    expect(facturaRecuperada.items?.[1]?.subtotal).toBe('2000.00');
  });

  it('permite consultar estado y guardar configuración de AFIP / ARCA (CAE y CAI)', async () => {
    // 1. Consultar estado inicial
    const resEstado = await app.inject({
      method: 'GET',
      url: '/facturacion/afip/estado',
      headers: { Authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    expect(resEstado.statusCode).toBe(200);
    const estado = resEstado.json<{
      configurado: boolean;
      servidores: { appServer: string; dbServer: string };
    }>();
    expect(estado.servidores.appServer).toBe('OK');

    // 2. Guardar configuración con CUIT y CAI de contingencia
    const resConfig = await app.inject({
      method: 'POST',
      url: '/facturacion/afip/configuracion',
      headers: { Authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        entorno: 'homologacion',
        cuit: '30712345678',
        puntoVenta: 1,
        caiContingencia: '12345678901234',
        vencimientoCai: '2026-12-31',
        activo: true,
      },
    });
    expect(resConfig.statusCode).toBe(200);

    // 3. Test de conexión
    const resPing = await app.inject({
      method: 'POST',
      url: '/facturacion/afip/test-conexion',
      headers: { Authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: { entorno: 'homologacion' },
    });
    expect(resPing.statusCode).toBe(200);
    expect(resPing.json<{ ok: boolean }>().ok).toBe(true);

    // 4. Emitir comprobante bajo modalidad CAI
    const resCai = await app.inject({
      method: 'POST',
      url: '/facturacion/emitir',
      headers: { Authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        puntoVentaNumero: 1,
        tipoComprobante: 'factura_b',
        razonSocialCliente: 'CONSUMIDOR FINAL CAI',
        condicionIvaCliente: 'consumidor_final',
        alicuotaIva: '21',
        total: '5000.00',
        enContingenciaOffline: false,
      },
    });
    expect(resCai.statusCode).toBe(201);
    const cmpCai = resCai.json<ComprobanteFiscalDetalle>();
    expect(cmpCai.cae).toBe('12345678901234');
    expect(cmpCai.vencimientoCae).toBe('2026-12-31');
  });
});
