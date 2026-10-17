import { describe, expect, it } from 'vitest';
import {
  aCentavos,
  cantidadDecimalSchema,
  deCentavos,
  montoDecimalSchema,
  registrarVentaSchema,
  rolUsuarioSchema,
  sumarMontos,
} from './index.js';

describe('@ferreteria/shared schemas y aritmética de dinero', () => {
  it('valida roles de usuario permitidos', () => {
    expect(rolUsuarioSchema.safeParse('dueno').success).toBe(true);
    expect(rolUsuarioSchema.safeParse('encargado').success).toBe(true);
    expect(rolUsuarioSchema.safeParse('cajero').success).toBe(true);
    expect(rolUsuarioSchema.safeParse('admin').success).toBe(false);
  });

  it('valida importes decimales numeric(14,2) como string', () => {
    expect(montoDecimalSchema.safeParse('1234.50').success).toBe(true);
    expect(montoDecimalSchema.safeParse('2600').success).toBe(true);
    expect(montoDecimalSchema.safeParse('1234.567').success).toBe(false);
    expect(montoDecimalSchema.safeParse('-10.00').success).toBe(false);
  });

  it('valida cantidades decimales numeric(14,3) como string', () => {
    expect(cantidadDecimalSchema.safeParse('1.250').success).toBe(true);
    expect(cantidadDecimalSchema.safeParse('10').success).toBe(true);
    expect(cantidadDecimalSchema.safeParse('1.2505').success).toBe(false);
  });

  it('suma importes usando centavos enteros sin errores de coma flotante', () => {
    expect(aCentavos('2600')).toBe(260000n);
    expect(deCentavos(610000n)).toBe('6100.00');
    expect(sumarMontos(['2600.00', '200.00', '3300.00'])).toBe('6100.00');
    expect(sumarMontos(['0.10', '0.20'])).toBe('0.30');
  });

  it('verifica que la suma de pagos coincida con el total de la venta', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      turnoId: '22222222-2222-4222-8222-222222222222',
      total: '1000.00',
      pagos: [
        {
          movimientoId: '33333333-3333-4333-8333-333333333333',
          medioPagoId: '44444444-4444-4444-8444-444444444444',
          monto: '600.00',
        },
        {
          movimientoId: '55555555-5555-4555-8555-555555555555',
          medioPagoId: '66666666-6666-4666-8666-666666666666',
          monto: '400.00',
        },
      ],
    };

    expect(registrarVentaSchema.safeParse(base).success).toBe(true);
    expect(
      registrarVentaSchema.safeParse({ ...base, total: '999.00' }).success,
    ).toBe(false);
  });
});
