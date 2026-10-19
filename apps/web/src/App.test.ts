import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agregarDigitoTeclado,
  calcularSubtotalCentavos,
  formatearPesos,
} from './App.js';
import {
  encolarOperacion,
  limpiarCola,
  listarOperacionesPendientes,
  sincronizarColaPendiente,
  type OperacionCola,
} from './offline/cola-indexeddb.js';

describe('@ferreteria/web utilidades de formato, teclado y cola offline', () => {
  beforeEach(async () => {
    await limpiarCola();
  });

  it('formatea importes en pesos argentinos ($ 1.234,50) incluidos negativos', () => {
    expect(formatearPesos('1234.50')).toBe('$ 1.234,50');
    expect(formatearPesos('2600')).toBe('$ 2.600,00');
    expect(formatearPesos('-50.00')).toBe('- $ 50,00');
  });

  it('calcula subtotales exactos en centavos con cantidades decimales y descuentos', () => {
    // 2.5 unidades a $ 1.000,00 sin descuento = $ 2.500,00 -> 250000 centavos
    const subtotalSimple = calcularSubtotalCentavos('1000.00', 2.5, '0', '0.00');
    expect(subtotalSimple).toBe(250000n);

    // 1 unidad a $ 10.000,00 con 15% de descuento = $ 8.500,00 -> 850000 centavos
    const subtotalConPct = calcularSubtotalCentavos('10000.00', 1, '15', '0.00');
    expect(subtotalConPct).toBe(850000n);

    // 1 unidad a $ 5.000,00 con $ 500,00 de descuento en monto = $ 4.500,00 -> 450000 centavos
    const subtotalConMonto = calcularSubtotalCentavos('5000.00', 1, '0', '500.00');
    expect(subtotalConMonto).toBe(450000n);
  });

  it('opera el teclado numérico de mostrador en pocos toques', () => {
    let valor = '0';
    valor = agregarDigitoTeclado(valor, '2');
    valor = agregarDigitoTeclado(valor, '6');
    valor = agregarDigitoTeclado(valor, '00');
    expect(valor).toBe('2600');
    expect(agregarDigitoTeclado(valor, 'C')).toBe('0');
  });

  it('encola operaciones sin conexión y las sincroniza con los mismos IDs al volver a estar en línea', async () => {
    const opVenta: OperacionCola = {
      id: '11111111-1111-4111-8111-111111111111',
      tipo: 'venta',
      endpoint: '/api/ventas',
      token: 'token-prueba',
      creadoEn: '2026-10-16T19:00:00.000Z',
      intentos: 0,
      resumenLocal: {
        monto: '3300.00',
        esEfectivo: true,
        medioPagoNombre: 'Efectivo',
        etiqueta: 'Efectivo · Herramientas',
      },
      payload: {
        id: '11111111-1111-4111-8111-111111111111',
        turnoId: '22222222-2222-4222-8222-222222222222',
        total: '3300.00',
        pagos: [
          {
            movimientoId: '33333333-3333-4333-8333-333333333333',
            medioPagoId: '44444444-4444-4444-8444-444444444444',
            monto: '3300.00',
          },
        ],
      },
    };

    await encolarOperacion(opVenta);
    expect((await listarOperacionesPendientes()).length).toBe(1);

    // 1. Intento fallido (corte de red): conserva la operación en la cola e incrementa intentos
    const fetchFallido = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Network error'));
    const resFallido = await sincronizarColaPendiente(fetchFallido);
    expect(resFallido).toEqual({ sincronizadas: 0, pendientes: 1 });
    const trasFallo = await listarOperacionesPendientes();
    expect(trasFallo[0]?.intentos).toBe(1);
    expect(trasFallo[0]?.id).toBe('11111111-1111-4111-8111-111111111111');

    // 2. Vuelve internet: envía el mismo payload con los mismos UUIDs y vacía la cola
    const fetchExitoso = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ idempotente: false }), { status: 201 }),
    );
    const resExitoso = await sincronizarColaPendiente(fetchExitoso);
    expect(resExitoso).toEqual({ sincronizadas: 1, pendientes: 0 });
    expect(fetchExitoso).toHaveBeenCalledTimes(1);
    const [, init] = fetchExitoso.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      total: '3300.00',
    });
  });

  it('encola y sincroniza ventas con cuenta corriente, cliente y persona autorizada a retirar', async () => {
    const clienteId = '55555555-5555-4555-8555-555555555555';
    const autorizadoId = '66666666-6666-4666-8666-666666666666';
    const opVentaCtaCte: OperacionCola = {
      id: '77777777-7777-4777-8777-777777777777',
      tipo: 'venta',
      endpoint: '/api/ventas',
      token: 'token-cta-cte',
      creadoEn: '2026-10-19T17:00:00.000Z',
      intentos: 0,
      resumenLocal: {
        monto: '15400.00',
        esEfectivo: false,
        medioPagoNombre: 'Cuenta Corriente',
        etiqueta: 'Cuenta Corriente · Materiales (Construcciones SRL)',
      },
      payload: {
        id: '77777777-7777-4777-8777-777777777777',
        turnoId: '22222222-2222-4222-8222-222222222222',
        clienteId,
        autorizadoRetiroId: autorizadoId,
        total: '15400.00',
        pagos: [
          {
            movimientoId: '88888888-8888-4888-8888-888888888888',
            medioPagoId: '99999999-9999-4999-8999-999999999999',
            monto: '15400.00',
          },
        ],
      },
    };

    await encolarOperacion(opVentaCtaCte);
    const pendientes = await listarOperacionesPendientes();
    expect(pendientes.length).toBe(1);
    expect(pendientes[0]?.resumenLocal.medioPagoNombre).toBe('Cuenta Corriente');

    const fetchSync = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );

    const resultado = await sincronizarColaPendiente(fetchSync);
    expect(resultado).toEqual({ sincronizadas: 1, pendientes: 0 });

    const [, init] = fetchSync.mock.calls[0] ?? [];
    const payloadEnviado = JSON.parse(init?.body as string) as {
      clienteId?: string;
      autorizadoRetiroId?: string;
      total?: string;
    };
    expect(payloadEnviado.clienteId).toBe(clienteId);
    expect(payloadEnviado.autorizadoRetiroId).toBe(autorizadoId);
    expect(payloadEnviado.total).toBe('15400.00');
  });

  it('encola y sincroniza egreso de caja por pago a proveedor', async () => {
    const turnoId = '44444444-4444-4444-8444-444444444444';
    const opPagoProv: OperacionCola = {
      id: '55555555-5555-4555-8555-555555555555',
      tipo: 'egreso',
      endpoint: '/api/movimientos/egreso',
      token: 'token-cajero',
      creadoEn: '2026-10-19T21:00:00.000Z',
      intentos: 0,
      resumenLocal: {
        monto: '45000.00',
        esEfectivo: true,
        medioPagoNombre: 'Efectivo',
        etiqueta: 'Pago a Proveedor (Distribuidora Loma Negra)',
      },
      payload: {
        id: '55555555-5555-4555-8555-555555555555',
        turnoId,
        medioPagoId: '20000000-0000-4000-8000-000000000001',
        categoriaId: '10000000-0000-4000-8000-000000000007',
        monto: '45000.00',
        descripcion: 'Pago factura Loma Negra',
      },
    };

    await encolarOperacion(opPagoProv);
    const pendientes = await listarOperacionesPendientes();
    expect(pendientes.length).toBe(1);
    expect(pendientes[0]?.resumenLocal.etiqueta).toContain('Pago a Proveedor');

    const fetchSync = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );

    const resultado = await sincronizarColaPendiente(fetchSync);
    expect(resultado).toEqual({ sincronizadas: 1, pendientes: 0 });

    const [url, init] = fetchSync.mock.calls[0] ?? [];
    expect(url).toBe('/api/movimientos/egreso');
    const payloadEnviado = JSON.parse(init?.body as string) as {
      monto: string;
      turnoId: string;
    };
    expect(payloadEnviado.monto).toBe('45000.00');
    expect(payloadEnviado.turnoId).toBe(turnoId);
  });
});

