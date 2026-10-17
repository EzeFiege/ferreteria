import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agregarDigitoTeclado, formatearPesos } from './App.js';
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
});
