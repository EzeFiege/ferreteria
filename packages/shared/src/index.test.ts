import { describe, expect, it } from 'vitest';
import {
  aCentavos,
  aplicarRedondeoPrecio,
  cantidadDecimalSchema,
  deCentavos,
  evaluarDescuentoVolumen,
  formatearMensajeCtaCte,
  formatearMensajeDespacho,
  formatearMensajeOrdenCompra,
  formatearMensajePresupuesto,
  formatearMensajeTicket,
  generarLinkWhatsApp,
  montoDecimalSchema,
  normalizarTelefonoWhatsApp,
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

  it('evalúa reglas de descuento por volumen correctamente con precedencia producto vs rubro', () => {
    const reglas = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        nombre: 'Promo 10+ Tornillos',
        productoId: '22222222-2222-4222-8222-222222222222',
        productoCodigo: 'TOR-01',
        productoNombre: 'Tornillo',
        rubroId: null,
        rubroNombre: null,
        listaPrecioId: null,
        listaPrecioNombre: null,
        cantidadMinima: '10.000',
        descuentoPct: '15.00',
        activo: true,
        creadoEn: new Date().toISOString(),
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        nombre: 'Promo Rubro Bulonería 50+',
        productoId: null,
        productoCodigo: null,
        productoNombre: null,
        rubroId: '44444444-4444-4444-8444-444444444444',
        rubroNombre: 'Bulonería',
        listaPrecioId: null,
        listaPrecioNombre: null,
        cantidadMinima: '50.000',
        descuentoPct: '10.00',
        activo: true,
        creadoEn: new Date().toISOString(),
      },
    ];

    // Caso 1: Cantidad insuficiente (5 unidades) -> sin descuento
    const r1 = evaluarDescuentoVolumen({
      productoId: '22222222-2222-4222-8222-222222222222',
      rubroId: '44444444-4444-4444-8444-444444444444',
      cantidad: 5,
      reglas,
    });
    expect(r1).toBeNull();

    // Caso 2: Cantidad cumple regla de producto (12 unidades) -> 15%
    const r2 = evaluarDescuentoVolumen({
      productoId: '22222222-2222-4222-8222-222222222222',
      rubroId: '44444444-4444-4444-8444-444444444444',
      cantidad: 12,
      reglas,
    });
    expect(r2).toEqual({
      descuentoPct: '15.00',
      reglaNombre: 'Promo 10+ Tornillos',
    });

    // Caso 3: Otro producto del mismo rubro que cumple 60 unidades -> 10% por rubro
    const r3 = evaluarDescuentoVolumen({
      productoId: '99999999-9999-4999-8999-999999999999',
      rubroId: '44444444-4444-4444-8444-444444444444',
      cantidad: 60,
      reglas,
    });
    expect(r3).toEqual({
      descuentoPct: '10.00',
      reglaNombre: 'Promo Rubro Bulonería 50+',
    });
  });

  it('Fase 19: aplica reglas de redondeo comercial a precios en pesos', () => {
    // ninguno
    expect(aplicarRedondeoPrecio('1234.56', 'ninguno')).toBe('1234.56');

    // entero (al peso más cercano)
    expect(aplicarRedondeoPrecio('1234.40', 'entero')).toBe('1234.00');
    expect(aplicarRedondeoPrecio('1234.50', 'entero')).toBe('1235.00');

    // múltiplo de $10
    expect(aplicarRedondeoPrecio('1234.00', 'multiplo_10')).toBe('1230.00');
    expect(aplicarRedondeoPrecio('1235.00', 'multiplo_10')).toBe('1240.00');
    expect(aplicarRedondeoPrecio('1238.90', 'multiplo_10')).toBe('1240.00');

    // múltiplo de $50
    expect(aplicarRedondeoPrecio('1220.00', 'multiplo_50')).toBe('1200.00');
    expect(aplicarRedondeoPrecio('1225.00', 'multiplo_50')).toBe('1250.00');
    expect(aplicarRedondeoPrecio('1270.00', 'multiplo_50')).toBe('1250.00');
    expect(aplicarRedondeoPrecio('1280.00', 'multiplo_50')).toBe('1300.00');

    // múltiplo de $100
    expect(aplicarRedondeoPrecio('1240.00', 'multiplo_100')).toBe('1200.00');
    expect(aplicarRedondeoPrecio('1250.00', 'multiplo_100')).toBe('1300.00');
  });

  it('Fase 21: normaliza teléfonos argentinos y genera enlaces wa.me con mensajes formateados', () => {
    // 1. Normalización de formatos argentinos comunes
    expect(normalizarTelefonoWhatsApp('11 4567-8901')).toBe('5491145678901');
    expect(normalizarTelefonoWhatsApp('011 15 4567 8901')).toBe('5491145678901');
    expect(normalizarTelefonoWhatsApp('+54 9 11 4567-8901')).toBe('5491145678901');
    expect(normalizarTelefonoWhatsApp('221 456-7890')).toBe('5492214567890');
    expect(normalizarTelefonoWhatsApp('0341 15 1234567')).toBe('5493411234567');

    // 2. Generación de enlaces wa.me
    const linkConTel = generarLinkWhatsApp('11 4567-8901', 'Hola Mundo');
    expect(linkConTel).toBe('https://wa.me/5491145678901?text=Hola%20Mundo');

    const linkSinTel = generarLinkWhatsApp('', 'Mensaje general');
    expect(linkSinTel).toBe('https://wa.me/?text=Mensaje%20general');

    // 3. Formateo de Ticket de Venta
    const msgTicket = formatearMensajeTicket({
      nombreNegocio: 'Ferretería Central',
      nombreCliente: 'Juan Pérez',
      numeroTicket: 1042,
      totalPesos: '$ 15.200,00',
      medioCobro: 'Efectivo',
      cantidadArticulos: 3,
    });
    expect(msgTicket).toContain('Juan Pérez');
    expect(msgTicket).toContain('Ferretería Central');
    expect(msgTicket).toContain('#1042');
    expect(msgTicket).toContain('$ 15.200,00');

    // 4. Formateo de Cuenta Corriente
    const msgCtaCte = formatearMensajeCtaCte({
      nombreNegocio: 'Ferretería Central',
      nombreCliente: 'Construcciones SRL',
      saldoPesos: '$ 84.500,00',
      aliasCbu: 'ferreteria.central.pagos',
    });
    expect(msgCtaCte).toContain('Construcciones SRL');
    expect(msgCtaCte).toContain('$ 84.500,00');
    expect(msgCtaCte).toContain('ferreteria.central.pagos');

    // 5. Formateo de Presupuesto
    const msgPresupuesto = formatearMensajePresupuesto({
      nombreNegocio: 'Ferretería Central',
      nombreCliente: 'Martín',
      numeroPresupuesto: 'PRE-0025',
      totalPesos: '$ 45.000,00',
      diasValidez: 7,
    });
    expect(msgPresupuesto).toContain('PRE-0025');
    expect(msgPresupuesto).toContain('7 días');

    // 6. Formateo de Despacho Logístico
    const msgDespacho = formatearMensajeDespacho({
      nombreNegocio: 'Ferretería Central',
      nombreCliente: 'Carlos Gómez',
      numeroDespacho: 'DESP-0001',
      direccionDestino: 'Av. Belgrano 1234',
      fleteroNombre: 'Roberto',
      fleteroTelefono: '11 9988-7766',
    });
    expect(msgDespacho).toContain('DESP-0001');
    expect(msgDespacho).toContain('Roberto');
    expect(msgDespacho).toContain('Av. Belgrano 1234');

    // 7. Formateo de Pedido a Proveedor
    const msgProveedor = formatearMensajeOrdenCompra({
      nombreNegocio: 'Ferretería Central',
      nombreProveedor: 'Bulonera Argentina',
      numeroOrden: 'OC-0099',
      cantidadArticulos: 12,
    });
    expect(msgProveedor).toContain('Bulonera Argentina');
    expect(msgProveedor).toContain('OC-0099');
    expect(msgProveedor).toContain('12');
  });

  it('normaliza enlaces de Google Drive a URLs directas de imagen e integra en guardarProductoSchema', async () => {
    const { normalizarUrlImagen, guardarProductoSchema } = await import('./index.js');

    // 1. Enlace compartido estándar de Google Drive (view?usp=sharing)
    const driveShare = 'https://drive.google.com/file/d/1XyZ987AbCdEf_012/view?usp=sharing';
    expect(normalizarUrlImagen(driveShare)).toBe(
      'https://drive.google.com/thumbnail?id=1XyZ987AbCdEf_012&sz=w1000',
    );

    // 2. Enlace open?id= de Google Drive
    const driveOpen = 'https://drive.google.com/open?id=1XyZ987AbCdEf_012';
    expect(normalizarUrlImagen(driveOpen)).toBe(
      'https://drive.google.com/thumbnail?id=1XyZ987AbCdEf_012&sz=w1000',
    );

    // 3. Enlace uc?id= de Google Drive
    const driveUc = 'https://drive.google.com/uc?export=view&id=1XyZ987AbCdEf_012';
    expect(normalizarUrlImagen(driveUc)).toBe(
      'https://drive.google.com/thumbnail?id=1XyZ987AbCdEf_012&sz=w1000',
    );

    // 4. Enlace de Dropbox (?dl=0 -> ?raw=1)
    const dropbox = 'https://www.dropbox.com/s/xyz123/foto.jpg?dl=0';
    expect(normalizarUrlImagen(dropbox)).toBe('https://www.dropbox.com/s/xyz123/foto.jpg?raw=1');

    // 5. Validación en esquema de producto con Google Drive y Data URI
    const resDrive = guardarProductoSchema.safeParse({
      codigo: 'PROD-DRIVE',
      nombre: 'Taladro con foto Drive',
      costoBase: '1000.00',
      imagenUrl: normalizarUrlImagen(driveShare),
    });
    expect(resDrive.success).toBe(true);

    const resDataUri = guardarProductoSchema.safeParse({
      codigo: 'PROD-FILE',
      nombre: 'Taladro con foto archivo',
      costoBase: '1000.00',
      imagenUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
    });
    expect(resDataUri.success).toBe(true);
  });
});
