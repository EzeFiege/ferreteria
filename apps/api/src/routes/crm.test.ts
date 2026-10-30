import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ClienteContactoBitacoraItem,
  ClienteObraItem,
  PresupuestoKanbanItem,
  SegmentacionClienteItem,
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
  tokenDueno: string;
}

describe('Fase 23 — CRM Comercial 360° (Obras, Pipeline y Bitácora)', () => {
  let testDb: TestDatabaseHandle;
  let adminPool: pg.Pool;
  let app: FastifyInstance;
  let negocioA: NegocioPrueba;
  let negocioB: NegocioPrueba;
  let clienteAId: string;
  let obraCreadaId: string;
  let presupuestoId: string;

  async function sembrarNegocio(nombre: string): Promise<NegocioPrueba> {
    const negocioId = randomUUID();
    const duenoId = randomUUID();

    await adminPool.query(
      `insert into negocio (id, nombre, cuit, condicion_iva) values ($1, $2, '30112233445', 'responsable_inscripto')`,
      [negocioId, nombre],
    );

    await adminPool.query(
      `insert into usuario (id, negocio_id, proveedor_uid, email, password_hash, nombre, rol)
       values ($1, $2, $4, $3, 'hash_test', 'Dueño', 'dueno')`,
      [duenoId, negocioId, `dueno_${negocioId.slice(0, 6)}@test.com`, `uid_d_${negocioId.slice(0, 6)}`],
    );

    await adminPool.query(`select sembrar_negocio($1)`, [negocioId]);

    const tokenDueno = createAuthToken({
      negocio_id: negocioId,
      usuario_id: duenoId,
      rol: 'dueno',
    });

    return {
      negocioId,
      duenoId,
      tokenDueno,
    };
  }

  beforeAll(async () => {
    testDb = await createIsolatedTestDatabase();
    await runMigrations({
      connectionString: testDb.url,
    });

    adminPool = new Pool({ connectionString: testDb.url });
    negocioA = await sembrarNegocio('Ferretería Central');
    negocioB = await sembrarNegocio('Ferretería Rivadavia');

    app = buildServer({
      databaseUrl: testDb.url,
      logger: false,
    });

    // Crear cliente de prueba en Negocio A
    clienteAId = randomUUID();
    await adminPool.query(
      `insert into cliente (id, negocio_id, codigo, nombre, cuit_dni, condicion_iva, telefono)
       values ($1, $2, 'CLI-OBRA1', 'Constructora Del Plata S.A.', '30712233449', 'responsable_inscripto', '1144556677')`,
      [clienteAId, negocioA.negocioId],
    );
  });

  afterAll(async () => {
    await app.close();
    await adminPool.end();
    await testDb.cleanup();
  });

  it('1. Crea una obra asociada a un cliente y la lista correctamente', async () => {
    const resCrear = await app.inject({
      method: 'POST',
      url: '/crm/obras',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        clienteId: clienteAId,
        nombre: 'Torre Alvear 450',
        direccion: 'Av. Alvear 450',
        localidad: 'CABA',
        contactoResponsable: 'Ing. Carlos Rossi',
        telefonoResponsable: '1122334455',
        fechaInicio: '2026-11-01',
        fechaFinEstimada: '2027-06-30',
        estado: 'activa',
        presupuestoEstimado: '15000000.00',
        notas: 'Entrega por portón lateral de obra.',
      },
    });

    expect(resCrear.statusCode).toBe(201);
    const obra = resCrear.json<ClienteObraItem>();
    expect(obra.id).toBeDefined();
    expect(obra.nombre).toBe('Torre Alvear 450');
    expect(obra.clienteNombre).toBe('Constructora Del Plata S.A.');
    expect(obra.contactoResponsable).toBe('Ing. Carlos Rossi');
    obraCreadaId = obra.id;

    // Listar obras
    const resListar = await app.inject({
      method: 'GET',
      url: '/crm/obras',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });

    expect(resListar.statusCode).toBe(200);
    const lista = resListar.json<ClienteObraItem[]>();
    expect(lista.length).toBeGreaterThanOrEqual(1);
    const encontrada = lista.find((o) => o.id === obraCreadaId);
    expect(encontrada).toBeDefined();
    expect(encontrada?.presupuestoEstimado).toBe('15000000.00');
  });

  it('2. Actualiza los datos de la obra', async () => {
    const resActualizar = await app.inject({
      method: 'PATCH',
      url: `/crm/obras/${obraCreadaId}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        estado: 'pausada',
        notas: 'Pausada por lluvias y replanteo de cimientos.',
      },
    });

    expect(resActualizar.statusCode).toBe(200);
    const actualizada = resActualizar.json<ClienteObraItem>();
    expect(actualizada.estado).toBe('pausada');
    expect(actualizada.notas).toBe('Pausada por lluvias y replanteo de cimientos.');
  });

  it('3. Registra y consulta la bitácora de seguimiento comercial', async () => {
    const resBitacora = await app.inject({
      method: 'POST',
      url: '/crm/bitacora',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        clienteId: clienteAId,
        obraId: obraCreadaId,
        tipo: 'llamada',
        descripcion: 'Conversación con capataz: confirman pedido de 200 bolsas de cemento.',
        proximoContactoFecha: '2026-11-05',
        proximoContactoAccion: 'Enviar cotización formal con flete bonificado',
      },
    });

    expect(resBitacora.statusCode).toBe(201);
    const entrada = resBitacora.json<ClienteContactoBitacoraItem>();
    expect(entryCheck(entrada.descripcion)).toBe(true);
    expect(entrada.obraNombre).toBe('Torre Alvear 450');

    function entryCheck(desc: string): boolean {
      return desc.includes('confirman pedido');
    }

    // Listar bitácora
    const resListar = await app.inject({
      method: 'GET',
      url: `/crm/bitacora?clienteId=${clienteAId}`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });

    expect(resListar.statusCode).toBe(200);
    const lista = resListar.json<ClienteContactoBitacoraItem[]>();
    expect(lista.length).toBeGreaterThanOrEqual(1);
    expect(lista[0]?.tipo).toBe('llamada');
  });

  it('4. Pipeline Kanban: presupuesto con obra y transición de etapas', async () => {
    // Crear un presupuesto asignado a la obra
    const resPres = await app.inject({
      method: 'POST',
      url: '/presupuestos',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        clienteId: clienteAId,
        obraId: obraCreadaId,
        nombreContacto: 'Ing. Carlos Rossi',
        diasValidez: 15,
        subtotal: '250000.00',
        descuentoGeneral: '0.00',
        total: '250000.00',
        observaciones: 'Cotización especial materiales gruesos',
        items: [
          {
            nombre: 'Cemento Portland 50kg',
            unidad: 'bolsa',
            cantidad: '20.000',
            precioUnitario: '12500.00',
            subtotal: '250000.00',
          },
        ],
      },
    });

    expect(resPres.statusCode).toBe(201);
    const nuevoPres = resPres.json<{ id: string }>();
    presupuestoId = nuevoPres.id;

    // Consultar el pipeline Kanban
    const resPipeline = await app.inject({
      method: 'GET',
      url: '/crm/pipeline',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });

    expect(resPipeline.statusCode).toBe(200);
    const tarjetas = resPipeline.json<PresupuestoKanbanItem[]>();
    const tarjeta = tarjetas.find((t) => t.id === presupuestoId);
    expect(tarjeta).toBeDefined();
    expect(tarjeta?.obraNombre).toBe('Torre Alvear 450');
    expect(tarjeta?.etapaCrm).toBe('enviado');

    // Cambiar de etapa en el pipeline a 'negociacion'
    const resEtapa = await app.inject({
      method: 'PATCH',
      url: `/crm/pipeline/${presupuestoId}/etapa`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        etapaCrm: 'negociacion',
        probabilidadPct: 80,
      },
    });

    expect(resEtapa.statusCode).toBe(200);
    expect(resEtapa.json<{ etapaCrm: string }>().etapaCrm).toBe('negociacion');

    // Pasar a ganado
    const resGanado = await app.inject({
      method: 'PATCH',
      url: `/crm/pipeline/${presupuestoId}/etapa`,
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
      payload: {
        etapaCrm: 'ganado',
        probabilidadPct: 100,
      },
    });

    expect(resGanado.statusCode).toBe(200);
    expect(resGanado.json<{ etapaCrm: string }>().etapaCrm).toBe('ganado');
  });

  it('5. Segmentación RFM clasifica los clientes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/crm/segmentacion',
      headers: { authorization: `Bearer ${negocioA.tokenDueno}` },
    });

    expect(res.statusCode).toBe(200);
    const clientes = res.json<SegmentacionClienteItem[]>();
    expect(clientes.length).toBeGreaterThanOrEqual(1);
    const cli = clientes.find((c) => c.clienteId === clienteAId);
    expect(cli).toBeDefined();
    expect(cli?.obrasActivas).toBeGreaterThanOrEqual(0);
    expect(['vip', 'frecuente', 'regular', 'riesgo_abandono', 'inactivo']).toContain(
      cli?.categoriaRfm,
    );
  });

  it('6. Regla 8 (Multi-negocio RLS): Negocio B no ve las obras de Negocio A', async () => {
    const resB = await app.inject({
      method: 'GET',
      url: '/crm/obras',
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
    });

    expect(resB.statusCode).toBe(200);
    const obrasB = resB.json<ClienteObraItem[]>();
    const filtrada = obrasB.find((o) => o.id === obraCreadaId);
    expect(filtrada).toBeUndefined();

    // Intentar modificar obra ajena desde Negocio B debe fallar (404 por RLS)
    const resPatchB = await app.inject({
      method: 'PATCH',
      url: `/crm/obras/${obraCreadaId}`,
      headers: { authorization: `Bearer ${negocioB.tokenDueno}` },
      payload: {
        nombre: 'Intento Hackeo Obra',
      },
    });

    expect(resPatchB.statusCode).toBe(404);
  });
});
