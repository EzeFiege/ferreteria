import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  DespachoEnvioResumen,
  HojaRutaDetalleCompleto,
} from '@ferreteria/shared';
import { createAuthToken } from '../auth.js';
import { runMigrations } from '../db/migrate.js';
import { buildServer } from '../server.js';
import {
  createIsolatedTestDatabase,
  type TestDatabaseHandle,
} from '../db/test-db.js';

const { Pool } = pg;

interface NegocioPrueba {
  negocioId: string;
  duenoId: string;
  cajeroId: string;
  tokenDueno: string;
  tokenCajero: string;
  clienteId: string;
}

describe('Fase 20 — Logística de Envíos y Hojas de Ruta para Fletero', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;
  let negocioA: NegocioPrueba;
  let negocioB: NegocioPrueba;

  async function sembrarNegocio(nombre: string): Promise<NegocioPrueba> {
    const negocioId = randomUUID();
    const duenoId = randomUUID();
    const cajeroId = randomUUID();
    const clienteId = randomUUID();

    await adminPool.query(
      `insert into negocio (id, nombre, cuit, condicion_iva) values ($1, $2, '30112233445', 'responsable_inscripto')`,
      [negocioId, nombre],
    );

    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, email, password_hash, nombre, rol)
       values ($1, $2, $5, $3, 'hash_test', 'Dueño', 'dueno'),
              ($4, $2, $6, 'cajero@test.com', 'hash_test', 'Cajero', 'cajero')`,
      [
        duenoId,
        negocioId,
        `dueno_${negocioId.slice(0, 6)}@test.com`,
        cajeroId,
        `uid_d_${negocioId.slice(0, 6)}`,
        `uid_c_${negocioId.slice(0, 6)}`,
      ],
    );

    await adminPool.query(
      `insert into cliente (id, negocio_id, codigo, nombre, cuit_dni, direccion, telefono)
       values ($1, $2, 'CLI-LOG-1', 'Constructora Aconcagua', '30-77889900-1', 'Av. San Martín 1234', '11-4455-6677')`,
      [clienteId, negocioId],
    );

    const tokenDueno = createAuthToken({
      negocio_id: negocioId,
      usuario_id: duenoId,
      rol: 'dueno',
    });
    const tokenCajero = createAuthToken({
      negocio_id: negocioId,
      usuario_id: cajeroId,
      rol: 'cajero',
    });

    return {
      negocioId,
      duenoId,
      cajeroId,
      tokenDueno,
      tokenCajero,
      clienteId,
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
      appUserPassword: 'test_password',
    });

    adminPool = new Pool({ connectionString: testDb.url });
    negocioA = await sembrarNegocio('Ferretería Logística A');
    negocioB = await sembrarNegocio('Ferretería Logística B');

    app = buildServer({
      databaseUrl: testDb.url,
      logger: false,
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Registra un nuevo despacho/envío a domicilio y lo lista en estado pendiente', async () => {
    const payload = {
      clienteId: negocioA.clienteId,
      direccionDestino: 'Ruta 9 Km 45, Loteo Los Alerces',
      localidad: 'Campana',
      contactoNombre: 'Arq. Roberto Gómez',
      contactoTelefono: '11-9988-7766',
      franjaHoraria: 'Tarde 13:00 a 17:00',
      costoFlete: '3500.00',
      notasDespacho: 'Bajar cemento sobre pallets en la entrada principal',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/logistica/envios',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ ok: boolean; id: string; numero: string }>();
    expect(body.ok).toBe(true);
    expect(body.numero).toBe('ENV-0001');

    // Listar envíos
    const resList = await app.inject({
      method: 'GET',
      url: '/logistica/envios?estado=pendiente',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    expect(resList.statusCode).toBe(200);
    const dataList = resList.json<{ envios: DespachoEnvioResumen[] }>();
    expect(dataList.envios).toHaveLength(1);
    const envio = dataList.envios[0];
    expect(envio).toBeDefined();
    expect(envio?.numero).toBe('ENV-0001');
    expect(envio?.estado).toBe('pendiente');
    expect(envio?.clienteNombre).toBe('Constructora Aconcagua');
    expect(envio?.costoFlete).toBe('3500.00');
    expect(envio?.hojaRutaId).toBeNull();
  });

  it('2. Agrupa despachos en una Hoja de Ruta para Fletero y actualiza estado a en_camino', async () => {
    // Crear un segundo envío
    const resEnv2 = await app.inject({
      method: 'POST',
      url: '/logistica/envios',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        clienteId: negocioA.clienteId,
        direccionDestino: 'Av. Rivadavia 450',
        localidad: 'Zárate',
        contactoNombre: 'Esteban Capataz',
        costoFlete: '2000.00',
      },
    });
    const env2 = resEnv2.json<{ id: string }>();

    // Obtener los dos envíos pendientes
    const resList = await app.inject({
      method: 'GET',
      url: '/logistica/envios?sinAsignar=true',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const envios = resList.json<{ envios: DespachoEnvioResumen[] }>().envios;
    expect(envios.length).toBeGreaterThanOrEqual(2);

    const despId1 = envios[0]?.id ?? '';
    const despId2 = env2.id;

    // Crear Hoja de Ruta
    const resHoja = await app.inject({
      method: 'POST',
      url: '/logistica/hojas-ruta',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        fleteroNombre: 'Carlos Fletero',
        fleteroTelefono: '11-2233-4455',
        vehiculoPatente: 'AF123ZZ',
        observaciones: 'Reparto mañana zona norte',
        despachosIds: [despId1, despId2],
      },
    });

    expect(resHoja.statusCode).toBe(201);
    const bodyHoja = resHoja.json<{ ok: boolean; id: string; numero: string }>();
    expect(bodyHoja.numero).toBe('HDR-0001');

    // Consultar detalle de la hoja de ruta
    const resDetalle = await app.inject({
      method: 'GET',
      url: `/logistica/hojas-ruta/${bodyHoja.id}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });

    expect(resDetalle.statusCode).toBe(200);
    const detalle = resDetalle.json<HojaRutaDetalleCompleto>();
    expect(detalle.numero).toBe('HDR-0001');
    expect(detalle.totalParadas).toBe(2);
    expect(detalle.paradasEntregadas).toBe(0);
    expect(detalle.paradas).toHaveLength(2);
    expect(detalle.paradas[0]?.ordenParada).toBe(1);
    expect(detalle.paradas[1]?.ordenParada).toBe(2);

    // Verificar que los despachos asociados ahora figuran en estado 'en_camino'
    const resEnviosActualizados = await app.inject({
      method: 'GET',
      url: '/logistica/envios?estado=en_camino',
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
    });
    const enviosEnCamino = resEnviosActualizados.json<{ envios: DespachoEnvioResumen[] }>().envios;
    expect(enviosEnCamino.length).toBeGreaterThanOrEqual(2);
    expect(enviosEnCamino.some((e) => e.hojaRutaNumero === 'HDR-0001')).toBe(true);
  });

  it('3. Registra entrega de parada individual y finaliza la hoja de ruta', async () => {
    // Obtener la hoja de ruta creada
    const resHojas = await app.inject({
      method: 'GET',
      url: '/logistica/hojas-ruta',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const hojas = resHojas.json<{ hojasRuta: Array<{ id: string; numero: string }> }>().hojasRuta;
    const hojaId = hojas[0]?.id ?? '';

    const resDetalle = await app.inject({
      method: 'GET',
      url: `/logistica/hojas-ruta/${hojaId}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const detalle = resDetalle.json<HojaRutaDetalleCompleto>();
    const parada1 = detalle.paradas[0];
    const parada2 = detalle.paradas[1];
    expect(parada1).toBeDefined();
    expect(parada2).toBeDefined();

    // Marcar parada 1 como entregada
    const resEnt1 = await app.inject({
      method: 'PUT',
      url: `/logistica/hojas-ruta/${hojaId}/paradas/${parada1?.id ?? ''}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        estadoParada: 'entregado',
        observacionesEntrega: 'Recibió conforme el arquitecto',
      },
    });
    expect(resEnt1.statusCode).toBe(200);

    // Marcar parada 2 como entregada
    const resEnt2 = await app.inject({
      method: 'PUT',
      url: `/logistica/hojas-ruta/${hojaId}/paradas/${parada2?.id ?? ''}`,
      headers: { authorization: `Bearer ${negocioA.tokenCajero}` },
      payload: {
        estadoParada: 'entregado',
        observacionesEntrega: 'Entrega completa en obra',
      },
    });
    expect(resEnt2.statusCode).toBe(200);

    // Finalizar la hoja de ruta
    const resCierre = await app.inject({
      method: 'PUT',
      url: `/logistica/hojas-ruta/${hojaId}/estado`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        estado: 'finalizada',
      },
    });
    expect(resCierre.statusCode).toBe(200);

    // Verificar detalle final
    const resFinal = await app.inject({
      method: 'GET',
      url: `/logistica/hojas-ruta/${hojaId}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });
    const detalleFinal = resFinal.json<HojaRutaDetalleCompleto>();
    expect(detalleFinal.estado).toBe('finalizada');
    expect(detalleFinal.paradasEntregadas).toBe(2);
    expect(detalleFinal.totalParadas).toBe(2);
  });

  it('4. Aislamiento multi-negocio con RLS', async () => {
    // Negocio B no puede ver los envíos de Negocio A
    const resB = await app.inject({
      method: 'GET',
      url: '/logistica/envios',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resB.statusCode).toBe(200);
    const dataB = resB.json<{ envios: DespachoEnvioResumen[] }>();
    expect(dataB.envios).toHaveLength(0);

    // Negocio B no puede ver las hojas de ruta de Negocio A
    const resHojasB = await app.inject({
      method: 'GET',
      url: '/logistica/hojas-ruta',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });
    expect(resHojasB.statusCode).toBe(200);
    const hojasB = resHojasB.json<{ hojasRuta: unknown[] }>();
    expect(hojasB.hojasRuta).toHaveLength(0);
  });
});
