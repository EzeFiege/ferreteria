import { z } from 'zod';

/**
 * Roles permitidos en la tabla `usuario` (001_core_caja.sql).
 */
export const rolUsuarioSchema = z.enum(['dueno', 'encargado', 'cajero']);
export type RolUsuario = z.infer<typeof rolUsuarioSchema>;

/**
 * Tipos de movimiento en el libro `movimiento` (001_core_caja.sql).
 */
export const tipoMovimientoSchema = z.enum([
  'venta',
  'egreso',
  'retiro',
  'ingreso_extra',
  'ajuste',
]);
export type TipoMovimiento = z.infer<typeof tipoMovimientoSchema>;

/**
 * Sentido de un movimiento de caja.
 */
export const sentidoMovimientoSchema = z.enum(['in', 'out']);
export type SentidoMovimiento = z.infer<typeof sentidoMovimientoSchema>;

/**
 * Regla 3 de AGENTS.md: Dinero con numeric(14,2) en la base y strings decimales en TypeScript.
 * Nunca number con coma flotante para sumar importes.
 */
export const montoDecimalSchema = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    'El importe debe ser un decimal válido de hasta 2 decimales',
  );

export const montoPositivoSchema = montoDecimalSchema.refine(
  (val) => aCentavos(val) > 0n,
  'El importe debe ser mayor a cero',
);

export const montoNoNegativoSchema = montoDecimalSchema;

/**
 * Regla 3 de AGENTS.md: Cantidades con numeric(14,3) (se vende por metro, kilo, litro).
 */
export const cantidadDecimalSchema = z
  .string()
  .regex(
    /^\d{1,11}(\.\d{1,3})?$/,
    'La cantidad debe ser un decimal válido de hasta 3 decimales',
  );

export const uuidSchema = z.string().uuid();

/**
 * Convierte un string decimal ("1234.50" o "2600") a centavos enteros (bigint)
 * sin tocar coma flotante en ningún momento.
 */
export function aCentavos(monto: string): bigint {
  const limpio = monto.trim();
  const negativo = limpio.startsWith('-');
  const sinSigno = negativo ? limpio.slice(1) : limpio;
  const partes = sinSigno.split('.');
  const enteroStr = partes[0] ?? '0';
  const decStr = (partes[1] ?? '').padEnd(2, '0').slice(0, 2);
  const centavos = BigInt(enteroStr) * 100n + BigInt(decStr);
  return negativo ? -centavos : centavos;
}

/**
 * Convierte centavos enteros (bigint) a string decimal con 2 decimales ("1234.50").
 */
export function deCentavos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const entero = abs / 100n;
  const dec = abs % 100n;
  const resultado = `${entero.toString()}.${dec.toString().padStart(2, '0')}`;
  return negativo ? `-${resultado}` : resultado;
}

/**
 * Suma una lista de importes decimales en string usando exclusivamente centavos enteros (bigint).
 */
export function sumarMontos(montos: readonly string[]): string {
  let total = 0n;
  for (const m of montos) {
    total += aCentavos(m);
  }
  return deCentavos(total);
}

/**
 * Esquemas de entrada para los endpoints del núcleo de caja (Etapa 1).
 */
export const abrirTurnoSchema = z.object({
  cajaId: uuidSchema,
  efectivoInicial: montoNoNegativoSchema.optional(),
  notas: z.string().max(500).optional(),
});
export type AbrirTurnoInput = z.infer<typeof abrirTurnoSchema>;

export const pagoVentaInputSchema = z.object({
  movimientoId: uuidSchema,
  medioPagoId: uuidSchema,
  monto: montoPositivoSchema,
  rubroId: uuidSchema.optional(),
  descripcion: z.string().max(500).optional(),
});
export type PagoVentaInput = z.infer<typeof pagoVentaInputSchema>;

export const itemVentaInputSchema = z.object({
  productoId: uuidSchema.optional(),
  descripcion: z.string().min(1).max(500),
  cantidad: cantidadDecimalSchema,
  precioUnit: montoNoNegativoSchema,
  unidad: z.enum(['principal', 'secundaria']).optional(),
  descuentoPct: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/)
    .optional(),
  descuentoMonto: montoNoNegativoSchema.optional(),
  subtotal: montoNoNegativoSchema.optional(),
});
export type ItemVentaInput = z.infer<typeof itemVentaInputSchema>;

export const registrarVentaSchema = z
  .object({
    id: uuidSchema,
    turnoId: uuidSchema,
    clienteId: uuidSchema.optional(),
    autorizadoRetiroId: uuidSchema.optional(),
    total: montoPositivoSchema,
    pagos: z.array(pagoVentaInputSchema).min(1),
    items: z.array(itemVentaInputSchema).optional(),
  })
  .refine(
    (data) => {
      const sumaPagos = data.pagos.reduce(
        (acc, p) => acc + aCentavos(p.monto),
        0n,
      );
      return sumaPagos === aCentavos(data.total);
    },
    {
      message: 'La suma de los pagos debe coincidir exactamente con el total de la venta',
      path: ['pagos'],
    },
  );
export type RegistrarVentaInput = z.infer<typeof registrarVentaSchema>;

export const registrarMovimientoCajaSchema = z.object({
  id: uuidSchema,
  turnoId: uuidSchema,
  medioPagoId: uuidSchema,
  categoriaId: uuidSchema.optional(),
  monto: montoPositivoSchema,
  descripcion: z.string().max(500).optional(),
});
export type RegistrarMovimientoCajaInput = z.infer<
  typeof registrarMovimientoCajaSchema
>;

export const revertirMovimientoSchema = z.object({
  id: uuidSchema,
  turnoId: uuidSchema.optional(),
  descripcion: z.string().max(500).optional(),
});
export type RevertirMovimientoInput = z.infer<typeof revertirMovimientoSchema>;

export const cerrarTurnoSchema = z.object({
  efectivoContado: montoNoNegativoSchema,
  notas: z.string().max(500).optional(),
});
export type CerrarTurnoInput = z.infer<typeof cerrarTurnoSchema>;

/**
 * Esquemas de filtros para Etapa 3 — Reportes del día e historial de turnos.
 */
export const fechaIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD');

export const filtrosHistorialTurnosSchema = z.object({
  fechaDesde: fechaIsoDateSchema.optional(),
  fechaHasta: fechaIsoDateSchema.optional(),
  cajaId: uuidSchema.optional(),
  cajeroId: uuidSchema.optional(),
});
export type FiltrosHistorialTurnosInput = z.infer<
  typeof filtrosHistorialTurnosSchema
>;

export const filtroReporteDiaSchema = z.object({
  fecha: fechaIsoDateSchema.optional(),
  cajaId: uuidSchema.optional(),
});
export type FiltroReporteDiaInput = z.infer<typeof filtroReporteDiaSchema>;

/**
 * Esquemas para Etapa 4 — Configuración de catálogos reales del negocio (rol dueno).
 */
export const comisionPctSchema = z
  .string()
  .regex(
    /^\d{1,3}(\.\d{1,2})?$/,
    'La comisión debe ser un porcentaje decimal válido (ej. 2.50)',
  )
  .refine(
    (val) => {
      const centesimos = aCentavos(val);
      return centesimos >= 0n && centesimos <= 10000n;
    },
    'La comisión debe estar entre 0.00% y 100.00%',
  );

export const guardarMedioPagoSchema = z.object({
  id: uuidSchema.optional(),
  nombre: z.string().trim().min(1).max(100),
  esEfectivo: z.boolean(),
  diasAcreditacion: z.number().int().min(0).max(365),
  comisionPct: comisionPctSchema,
  activo: z.boolean().optional(),
});
export type GuardarMedioPagoInput = z.infer<typeof guardarMedioPagoSchema>;

export const guardarRubroSchema = z.object({
  id: uuidSchema.optional(),
  nombre: z.string().trim().min(1).max(100),
});
export type GuardarRubroInput = z.infer<typeof guardarRubroSchema>;

export const guardarCategoriaSchema = z.object({
  id: uuidSchema.optional(),
  nombre: z.string().trim().min(1).max(100),
  tipo: z.enum(['ingreso', 'egreso']),
});
export type GuardarCategoriaInput = z.infer<typeof guardarCategoriaSchema>;

/**
 * Esquemas para Fase 2 — Catálogo de artículos, fraccionamiento, precios y stock vivo.
 */
export const guardarProductoSchema = z.object({
  id: uuidSchema.optional(),
  rubroId: uuidSchema.optional(),
  codigo: z.string().trim().min(1).max(100),
  sku: z.string().trim().max(100).optional().or(z.literal('')),
  nombre: z.string().trim().min(1).max(255),
  marca: z.string().trim().max(100).optional(),
  descripcion: z.string().max(1000).optional(),
  imagenUrl: z.string().url().max(1000).optional().or(z.literal('')),
  codigoQr: z.string().trim().max(255).optional(),
  costoBase: montoNoNegativoSchema,
  unidadPrincipal: z.string().trim().min(1).max(30).default('un'),
  unidadSecundaria: z.string().trim().max(30).optional().or(z.literal('')),
  factorConversion: cantidadDecimalSchema.default('1.000'),
  permiteFraccion: z.boolean().default(false),
  stockMinimo: cantidadDecimalSchema.default('0.000'),
  activo: z.boolean().default(true),
  codigosBarra: z.array(z.string().trim().min(1).max(100)).optional(),
});
export type GuardarProductoInput = z.infer<typeof guardarProductoSchema>;

export const guardarListaPrecioSchema = z.object({
  id: uuidSchema.optional(),
  nombre: z.string().trim().min(1).max(100),
  margenPct: comisionPctSchema,
  activo: z.boolean().optional(),
  orden: z.number().int().min(1).max(100).optional(),
});
export type GuardarListaPrecioInput = z.infer<typeof guardarListaPrecioSchema>;

export const ajusteStockSchema = z.object({
  id: uuidSchema.optional(),
  productoId: uuidSchema,
  tipo: z.enum([
    'ajuste_sobrante',
    'ajuste_faltante',
    'merma_rotura',
    'ingreso_compra',
    'devolucion',
  ]),
  cantidad: cantidadDecimalSchema,
  unidad: z.enum(['principal', 'secundaria']).default('principal'),
  costoUnitario: montoNoNegativoSchema.optional(),
  notas: z.string().max(500).optional(),
});
export type AjusteStockInput = z.infer<typeof ajusteStockSchema>;

export const lookupEanCandidatoSchema = z.object({
  nombre: z.string(),
  marca: z.string().optional(),
  rubro: z.string().optional(),
  sku: z.string().optional(),
  snippet: z.string().optional(),
});
export type LookupEanCandidato = z.infer<typeof lookupEanCandidatoSchema>;

export const lookupEanResultSchema = z.object({
  encontrado: z.boolean(),
  origen: z.enum(['local', 'mercadolibre', 'catalogo_externo', 'no_encontrado']),
  codigoBarra: z.string(),
  nombre: z.string().optional(),
  marca: z.string().optional(),
  sku: z.string().optional(),
  imagenUrl: z.string().optional(),
  rubroSugerido: z.string().optional(),
  productoId: uuidSchema.optional(),
  codigo: z.string().optional(),
  costoBase: montoDecimalSchema.optional(),
  stockActualBase: cantidadDecimalSchema.optional(),
  unidadPrincipal: z.string().optional(),
  unidadSecundaria: z.string().optional(),
  permiteFraccion: z.boolean().optional(),
  precios: z.record(z.string(), z.string()).optional(),
  candidatos: z.array(lookupEanCandidatoSchema).optional(),
});
export type LookupEanResult = z.infer<typeof lookupEanResultSchema>;

/**
 * Esquemas para Fase 3 — CRM de clientes, personas autorizadas y cuenta corriente.
 */
export const condicionIvaSchema = z.enum([
  'consumidor_final',
  'responsable_inscripto',
  'monotributo',
  'exento',
]);
export type CondicionIva = z.infer<typeof condicionIvaSchema>;

export const guardarClienteSchema = z.object({
  id: uuidSchema.optional(),
  codigo: z.string().trim().min(1).max(50),
  nombre: z.string().trim().min(1).max(255),
  cuitDni: z.string().trim().max(30).optional().or(z.literal('')),
  condicionIva: condicionIvaSchema.default('consumidor_final'),
  telefono: z.string().trim().max(50).optional().or(z.literal('')),
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  direccion: z.string().max(500).optional().or(z.literal('')),
  listaPrecioId: uuidSchema.optional(),
  limiteCredito: montoNoNegativoSchema.default('0.00'),
  diasPlazoCredito: z.number().int().min(0).max(365).default(30),
  activo: z.boolean().default(true),
  notas: z.string().max(1000).optional(),
});
export type GuardarClienteInput = z.infer<typeof guardarClienteSchema>;

export const guardarClienteAutorizadoSchema = z.object({
  id: uuidSchema.optional(),
  clienteId: uuidSchema,
  nombre: z.string().trim().min(1).max(255),
  dni: z.string().trim().max(30).optional().or(z.literal('')),
  rolParentesco: z.string().trim().max(100).optional().or(z.literal('')),
  telefono: z.string().trim().max(50).optional().or(z.literal('')),
  activo: z.boolean().default(true),
});
export type GuardarClienteAutorizadoInput = z.infer<
  typeof guardarClienteAutorizadoSchema
>;

export const registrarCobranzaCtaCteSchema = z.object({
  id: uuidSchema,
  clienteId: uuidSchema,
  turnoId: uuidSchema,
  medioPagoId: uuidSchema,
  monto: montoPositivoSchema,
  descripcion: z.string().max(500).optional(),
});
export type RegistrarCobranzaCtaCteInput = z.infer<
  typeof registrarCobranzaCtaCteSchema
>;

export const ajusteCtaCteSchema = z.object({
  id: uuidSchema,
  clienteId: uuidSchema,
  tipo: z.enum(['ajuste_debito', 'ajuste_credito']),
  monto: montoPositivoSchema,
  descripcion: z.string().min(1).max(500),
});
export type AjusteCtaCteInput = z.infer<typeof ajusteCtaCteSchema>;

/**
 * Esquemas para Fase 4 — Compras, proveedores, recepción de mercadería y cuentas a pagar.
 */
export const condicionIvaProveedorSchema = z.enum([
  'responsable_inscripto',
  'monotributo',
  'exento',
  'consumidor_final',
]);
export type CondicionIvaProveedor = z.infer<typeof condicionIvaProveedorSchema>;

export const guardarProveedorSchema = z.object({
  id: uuidSchema.optional(),
  codigo: z.string().trim().min(1).max(50),
  razonSocial: z.string().trim().min(1).max(255),
  nombreFantasia: z.string().trim().max(255).optional().or(z.literal('')),
  cuit: z.string().trim().max(30).optional().or(z.literal('')),
  condicionIva: condicionIvaProveedorSchema.default('responsable_inscripto'),
  telefono: z.string().trim().max(50).optional().or(z.literal('')),
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  direccion: z.string().max(500).optional().or(z.literal('')),
  contactoNombre: z.string().trim().max(255).optional().or(z.literal('')),
  diasPlazoPago: z.number().int().min(0).max(365).default(30),
  activo: z.boolean().default(true),
  notas: z.string().max(1000).optional(),
});
export type GuardarProveedorInput = z.infer<typeof guardarProveedorSchema>;

export const itemOrdenCompraInputSchema = z.object({
  id: uuidSchema.optional(),
  productoId: uuidSchema,
  descripcion: z.string().trim().min(1).max(255),
  cantidadPedida: cantidadDecimalSchema,
  costoUnitario: montoDecimalSchema,
  subtotal: montoDecimalSchema,
});
export type ItemOrdenCompraInput = z.infer<typeof itemOrdenCompraInputSchema>;

export const guardarOrdenCompraSchema = z.object({
  id: uuidSchema.optional(),
  numero: z.string().trim().min(1).max(50),
  proveedorId: uuidSchema,
  condicionPago: z.enum(['contado', 'cuenta_corriente']).default('cuenta_corriente'),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaEsperada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  total: montoDecimalSchema,
  notas: z.string().max(1000).optional(),
  items: z.array(itemOrdenCompraInputSchema).min(1),
});
export type GuardarOrdenCompraInput = z.infer<typeof guardarOrdenCompraSchema>;

export const recibirOrdenCompraSchema = z.object({
  ordenCompraId: uuidSchema,
  actualizarCostoBase: z.boolean().default(true),
  itemsRecibidos: z.array(
    z.object({
      productoId: uuidSchema,
      cantidadRecibida: cantidadDecimalSchema,
      costoUnitario: montoDecimalSchema,
    }),
  ),
});
export type RecibirOrdenCompraInput = z.infer<typeof recibirOrdenCompraSchema>;

export const registrarPagoProveedorSchema = z.object({
  id: uuidSchema.optional(),
  proveedorId: uuidSchema,
  turnoId: uuidSchema,
  medioPagoId: uuidSchema,
  monto: montoPositivoSchema,
  descripcion: z.string().max(500).optional(),
});
export type RegistrarPagoProveedorInput = z.infer<
  typeof registrarPagoProveedorSchema
>;

export const ajusteCtaCteProveedorSchema = z.object({
  id: uuidSchema.optional(),
  proveedorId: uuidSchema,
  tipo: z.enum(['ajuste_debito', 'ajuste_credito']),
  monto: montoPositivoSchema,
  descripcion: z.string().min(1).max(500),
});
export type AjusteCtaCteProveedorInput = z.infer<
  typeof ajusteCtaCteProveedorSchema
>;

// ─── Tesorería y Cheques (Fase 5) ──────────────────────────────────────────

export const tipoChequeSchema = z.enum(['fisico', 'echeq']);
export type TipoCheque = z.infer<typeof tipoChequeSchema>;

export const estadoChequeSchema = z.enum([
  'en_cartera',
  'depositado',
  'entregado_proveedor',
  'rechazado',
  'anulado',
]);
export type EstadoCheque = z.infer<typeof estadoChequeSchema>;

export const guardarChequeSchema = z.object({
  id: uuidSchema.optional(),
  tipo: tipoChequeSchema.default('fisico'),
  numero: z.string().min(1).max(50),
  banco: z.string().min(1).max(100),
  cuitEmisor: z.string().max(20).optional().nullable(),
  titular: z.string().max(150).optional().nullable(),
  fechaEmision: z.string().min(10).max(10).optional(),
  fechaPago: z.string().min(10).max(10),
  monto: montoPositivoSchema,
  clienteId: uuidSchema.optional().nullable(),
  movimientoCajaId: uuidSchema.optional().nullable(),
  notas: z.string().max(500).optional().nullable(),
});
export type GuardarChequeInput = z.infer<typeof guardarChequeSchema>;

export const depositarChequeSchema = z.object({
  cuentaBancariaDestino: z.string().min(1).max(100),
  fechaDeposito: z.string().min(10).max(10).optional(),
  notas: z.string().max(500).optional().nullable(),
});
export type DepositarChequeInput = z.infer<typeof depositarChequeSchema>;

export const endosarChequeProveedorSchema = z.object({
  proveedorId: uuidSchema,
  fechaEntrega: z.string().min(10).max(10).optional(),
  notas: z.string().max(500).optional().nullable(),
});
export type EndosarChequeProveedorInput = z.infer<
  typeof endosarChequeProveedorSchema
>;

export const rechazarChequeSchema = z.object({
  motivo: z.string().min(1).max(500),
});
export type RechazarChequeInput = z.infer<typeof rechazarChequeSchema>;

export interface ItemFlujoCajaProyectado {
  fecha: string;
  tipo: 'acreditacion_tarjeta' | 'cheque_en_cartera' | 'vencimiento_proveedor';
  descripcion: string;
  sentido: 'ingreso' | 'egreso';
  monto: string;
}

// ─── Facturación Fiscal ARCA / AFIP (Fase 6) ───────────────────────────────

export const tipoComprobanteFiscalSchema = z.enum([
  'factura_a',
  'nota_credito_a',
  'nota_debito_a',
  'factura_b',
  'nota_credito_b',
  'nota_debito_b',
  'factura_c',
  'nota_credito_c',
  'nota_debito_c',
]);
export type TipoComprobanteFiscal = z.infer<typeof tipoComprobanteFiscalSchema>;

export const estadoComprobanteFiscalSchema = z.enum([
  'autorizado',
  'contingencia_offline',
  'rechazado',
  'anulado',
]);
export type EstadoComprobanteFiscal = z.infer<
  typeof estadoComprobanteFiscalSchema
>;

export const guardarPuntoVentaSchema = z.object({
  id: uuidSchema.optional(),
  numero: z.number().int().min(1).max(99998),
  nombre: z.string().min(1).max(100),
  tipo: z.enum(['electronico_arca', 'manual_contingencia']).default('electronico_arca'),
  habilitado: z.boolean().default(true),
  cuitEmisor: z.string().max(20).optional().nullable(),
  inicioActividades: z.string().min(10).max(10).optional().nullable(),
  iibb: z.string().max(50).optional().nullable(),
  notas: z.string().max(500).optional().nullable(),
});
export type GuardarPuntoVentaInput = z.infer<typeof guardarPuntoVentaSchema>;

export const itemComprobanteFiscalInputSchema = z.object({
  id: uuidSchema.optional(),
  productoId: uuidSchema.optional().nullable(),
  codigo: z.string().max(50).optional().nullable(),
  descripcion: z.string().min(1).max(300),
  unidad: z.string().max(20).default('unidad'),
  cantidad: cantidadDecimalSchema,
  precioUnitario: montoNoNegativoSchema,
  alicuotaIva: z.enum(['21', '10.5', '27', '0']).default('21'),
  subtotal: montoNoNegativoSchema,
});
export type ItemComprobanteFiscalInput = z.infer<
  typeof itemComprobanteFiscalInputSchema
>;

export const emitirComprobanteFiscalSchema = z.object({
  id: uuidSchema.optional(),
  ventaId: uuidSchema.optional().nullable(),
  puntoVentaNumero: z.number().int().min(1).max(99998),
  tipoComprobante: tipoComprobanteFiscalSchema,
  clienteId: uuidSchema.optional().nullable(),
  cuitCliente: z.string().max(20).optional().nullable(),
  razonSocialCliente: z.string().min(1).max(200),
  condicionIvaCliente: condicionIvaSchema.default('consumidor_final'),
  domicilioCliente: z.string().max(200).optional().nullable(),
  alicuotaIva: z.enum(['21', '10.5', '27', '0']).default('21'),
  total: montoPositivoSchema,
  enContingenciaOffline: z.boolean().default(false),
  items: z.array(itemComprobanteFiscalInputSchema).optional(),
});
export type EmitirComprobanteFiscalInput = z.infer<
  typeof emitirComprobanteFiscalSchema
>;

export interface ItemComprobanteFiscalDetalle {
  id: string;
  comprobanteId: string;
  productoId: string | null;
  codigo: string | null;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string;
  alicuotaIva: string;
  subtotal: string;
  creadoEn: string;
}

export interface ComprobanteFiscalDetalle {
  id: string;
  puntoVentaNumero: number;
  tipoComprobante: TipoComprobanteFiscal;
  numeroComprobante: number;
  codigoAfip: number;
  fechaEmision: string;
  ventaId: string | null;
  cuitCliente: string | null;
  razonSocialCliente: string;
  condicionIvaCliente: CondicionIva;
  subtotalNetoGravado: string;
  subtotalIva21: string;
  subtotalIva105: string;
  subtotalIva27: string;
  subtotalExento: string;
  total: string;
  estado: EstadoComprobanteFiscal;
  cae: string | null;
  vencimientoCae: string | null;
  codigoQrArca: string | null;
  creadoEn: string;
  items?: ItemComprobanteFiscalDetalle[];
}

export const entornoAfipSchema = z.enum(['homologacion', 'produccion']);
export type EntornoAfip = z.infer<typeof entornoAfipSchema>;

export const guardarConfiguracionAfipSchema = z.object({
  entorno: entornoAfipSchema.default('homologacion'),
  cuit: z.string().min(10).max(13),
  puntoVenta: z.number().int().min(1).max(99998),
  certificadoPem: z.string().max(10000).optional().nullable(),
  clavePrivadaPem: z.string().max(10000).optional().nullable(),
  caiContingencia: z.string().max(20).optional().nullable(),
  vencimientoCai: z.string().max(10).optional().nullable(),
  activo: z.boolean().default(true),
});
export type GuardarConfiguracionAfipInput = z.infer<
  typeof guardarConfiguracionAfipSchema
>;

export interface EstadoAfipResponse {
  configurado: boolean;
  activo: boolean;
  entorno: EntornoAfip;
  cuit: string | null;
  puntoVenta: number;
  tieneCertificado: boolean;
  tieneClavePrivada: boolean;
  caiContingencia?: string | null;
  vencimientoCai?: string | null;
  servidores: {
    appServer: string;
    dbServer: string;
    authServer: string;
  };
}

// -------------------------------------------------------------
// Fase 7: Contabilidad y Partida Doble
// -------------------------------------------------------------

export const tipoCuentaContableSchema = z.enum([
  'activo',
  'pasivo',
  'patrimonio_neto',
  'ingreso',
  'egreso',
]);
export type TipoCuentaContable = z.infer<typeof tipoCuentaContableSchema>;

export const origenAsientoSchema = z.enum([
  'venta',
  'egreso_caja',
  'cobro_cta_cte',
  'compra_stock',
  'pago_proveedor',
  'deposito_cheque',
  'ajuste',
  'manual',
  'cierre_ejercicio',
  'refundicion_resultados',
]);
export type OrigenAsiento = z.infer<typeof origenAsientoSchema>;

export const guardarCuentaContableSchema = z.object({
  id: uuidSchema.optional(),
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(100),
  tipo: tipoCuentaContableSchema,
  descripcion: z.string().max(200).optional().nullable(),
  activa: z.boolean().default(true),
});
export type GuardarCuentaContableInput = z.infer<
  typeof guardarCuentaContableSchema
>;

export const renglonAsientoInputSchema = z.object({
  cuentaId: uuidSchema,
  debe: montoDecimalSchema.default('0.00'),
  haber: montoDecimalSchema.default('0.00'),
  descripcion: z.string().max(200).optional().nullable(),
});
export type RenglonAsientoInput = z.infer<typeof renglonAsientoInputSchema>;

export const crearAsientoManualSchema = z.object({
  fecha: z.string().optional(),
  concepto: z.string().min(3).max(250),
  origen: origenAsientoSchema.default('manual'),
  referenciaId: uuidSchema.optional().nullable(),
  renglones: z.array(renglonAsientoInputSchema).min(2),
});
export type CrearAsientoManualInput = z.infer<typeof crearAsientoManualSchema>;

export interface CuentaContableItem {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCuentaContable;
  descripcion: string | null;
  activa: boolean;
}

export interface RenglonAsientoDetalle {
  id: string;
  cuentaId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo: TipoCuentaContable;
  debe: string;
  haber: string;
  descripcion: string | null;
}

export interface AsientoContableDetalle {
  id: string;
  numero: number;
  fecha: string;
  concepto: string;
  origen: OrigenAsiento;
  referenciaId: string | null;
  creadoPor: string | null;
  creadoEn: string;
  totalDebe: string;
  totalHaber: string;
  cuadrado: boolean;
  renglones: RenglonAsientoDetalle[];
}

export interface ItemSumasYSaldos {
  cuentaId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo: TipoCuentaContable;
  cuentaActiva: boolean;
  totalDebe: string;
  totalHaber: string;
  saldoDeudor: string;
  saldoAcreedor: string;
}



// -------------------------------------------------------------
// Presupuestos y Cotizaciones de Mostrador
// -------------------------------------------------------------

export const estadoPresupuestoSchema = z.enum([
  'pendiente',
  'aprobado_convertido',
  'vencido',
  'cancelado',
]);
export type EstadoPresupuesto = z.infer<typeof estadoPresupuestoSchema>;

export const guardarItemPresupuestoSchema = z.object({
  id: uuidSchema.optional(),
  productoId: uuidSchema.optional().nullable(),
  codigo: z.string().max(50).optional().nullable(),
  nombre: z.string().min(1).max(200),
  unidad: z.string().max(20).default('unidad'),
  cantidad: cantidadDecimalSchema,
  precioUnitario: montoDecimalSchema,
  descuentoPct: z.string().default('0.00'),
  subtotal: montoDecimalSchema,
  notas: z.string().max(200).optional().nullable(),
});
export type GuardarItemPresupuestoInput = z.infer<
  typeof guardarItemPresupuestoSchema
>;

export const guardarPresupuestoSchema = z.object({
  id: uuidSchema.optional(),
  diasValidez: z.number().int().min(1).max(365).default(15),
  clienteId: uuidSchema.optional().nullable(),
  nombreContacto: z.string().max(100).optional().nullable(),
  telefonoContacto: z.string().max(50).optional().nullable(),
  emailContacto: z.string().email().optional().nullable(),
  listaPrecioId: uuidSchema.optional().nullable(),
  subtotal: montoDecimalSchema,
  descuentoGeneral: montoDecimalSchema.default('0.00'),
  total: montoDecimalSchema,
  observaciones: z.string().max(500).optional().nullable(),
  items: z.array(guardarItemPresupuestoSchema).min(1),
});
export type GuardarPresupuestoInput = z.infer<typeof guardarPresupuestoSchema>;

export interface ItemPresupuestoDetalle {
  id: string;
  presupuestoId: string;
  productoId: string | null;
  codigo: string | null;
  nombre: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string;
  descuentoPct: string;
  subtotal: string;
  notas: string | null;
}

export interface PresupuestoDetalle {
  id: string;
  numero: number;
  fechaEmision: string;
  fechaVencimiento: string;
  diasValidez: number;
  clienteId: string | null;
  nombreContacto: string | null;
  telefonoContacto: string | null;
  emailContacto: string | null;
  listaPrecioId: string | null;
  subtotal: string;
  descuentoGeneral: string;
  total: string;
  estado: EstadoPresupuesto;
  estaVencido: boolean;
  ventaId: string | null;
  observaciones: string | null;
  creadoPor: string | null;
  creadoEn: string;
  items: ItemPresupuestoDetalle[];
}

// -------------------------------------------------------------
// Fase 11 — Auditoría Centralizada y Cierre de Ejercicio
// -------------------------------------------------------------

export const accionAuditoriaSchema = z.enum([
  'anulacion_venta',
  'arqueo_caja',
  'ajuste_cta_cte_cliente',
  'ajuste_cta_cte_proveedor',
  'cambio_precio',
  'cierre_ejercicio',
  'apertura_ejercicio',
  'cheque_rechazado',
  'asiento_manual',
  'crear_acopio',
  'entrega_acopio',
  'crear_deposito',
  'crear_transferencia_stock',
]);
export type AccionAuditoria = z.infer<typeof accionAuditoriaSchema>;

export const entidadAuditoriaSchema = z.enum([
  'venta',
  'turno_caja',
  'cliente',
  'proveedor',
  'articulo',
  'ejercicio_contable',
  'cheque',
  'asiento_contable',
  'acopio',
  'deposito',
  'transferencia_stock',
]);
export type EntidadAuditoria = z.infer<typeof entidadAuditoriaSchema>;

export const filtroAuditoriaSchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  accion: accionAuditoriaSchema.optional(),
  entidad: entidadAuditoriaSchema.optional(),
  usuarioId: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroAuditoriaInput = z.infer<typeof filtroAuditoriaSchema>;

export interface RegistroAuditoriaItem {
  id: string;
  negocioId: string;
  usuarioId: string;
  usuarioEmail: string | null;
  rol: string;
  accion: AccionAuditoria;
  entidad: EntidadAuditoria;
  entidadId: string | null;
  detalles: Record<string, unknown>;
  creadoEn: string;
}

export const estadoEjercicioSchema = z.enum(['abierto', 'cerrado']);
export type EstadoEjercicio = z.infer<typeof estadoEjercicioSchema>;

export const crearEjercicioContableSchema = z.object({
  numero: z.number().int().positive().optional(),
  nombre: z.string().trim().min(3).max(100),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD requerido'),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD requerido'),
});
export type CrearEjercicioContableInput = z.infer<typeof crearEjercicioContableSchema>;

export const cerrarEjercicioContableSchema = z.object({
  ejercicioId: uuidSchema,
  concepto: z.string().max(250).optional(),
});
export type CerrarEjercicioContableInput = z.infer<typeof cerrarEjercicioContableSchema>;

export interface EjercicioContableItem {
  id: string;
  numero: number;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoEjercicio;
  asientoRefundicionId: string | null;
  asientoCierreId: string | null;
  cerradoPor: string | null;
  cerradoEn: string | null;
  creadoEn: string;
}

// -------------------------------------------------------------
// Fase 13: Autenticación, Sesión y Usuarios
// -------------------------------------------------------------

export const loginInputSchema = z.object({
  usuario: z.string().min(1, 'Ingresá tu usuario o email').max(100),
  password: z.string().min(1, 'Ingresá tu contraseña').max(100),
  negocioId: uuidSchema.optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export interface UsuarioSesion {
  id: string;
  negocioId: string;
  negocioNombre?: string;
  nombre: string;
  email?: string | null;
  rol: RolUsuario;
}

export interface LoginResponse {
  token: string;
  usuario: UsuarioSesion;
}

// -------------------------------------------------------------
// Fase 14: Carga Masiva desde Excel / CSV de Artículos y Precios
// -------------------------------------------------------------

export const itemImportacionProductoSchema = z.object({
  codigo: z.string().trim().min(1, 'El código es obligatorio').max(100),
  sku: z.string().trim().max(100).optional(),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(255),
  marca: z.string().trim().max(100).optional(),
  rubroNombre: z.string().trim().max(100).optional(),
  costoBase: montoNoNegativoSchema.default('0.00'),
  precioMostradorSugerido: montoNoNegativoSchema.optional(),
  precioGremioSugerido: montoNoNegativoSchema.optional(),
  unidadPrincipal: z.string().trim().min(1).max(30).default('un'),
  stockMinimo: cantidadDecimalSchema.default('0.000'),
  stockActual: cantidadDecimalSchema.optional(),
  codigoBarra: z.string().trim().max(100).optional(),
});
export type ItemImportacionProducto = z.infer<
  typeof itemImportacionProductoSchema
>;

export const importarProductosMasivoSchema = z.object({
  productos: z
    .array(itemImportacionProductoSchema)
    .min(1, 'Debe incluir al menos un producto')
    .max(2000, 'Máximo 2000 productos por lote'),
});
export type ImportarProductosMasivoInput = z.infer<
  typeof importarProductosMasivoSchema
>;

export interface ResultadoImportacionMasiva {
  totalProcesados: number;
  creados: number;
  actualizados: number;
  movimientosStockCreados: number;
  rubrosCreados: number;
}

// -------------------------------------------------------------
// Fase 15: Configuración de Empresa, Usuarios y Matriz de Roles
// -------------------------------------------------------------

export const guardarDatosEmpresaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre comercial es obligatorio')
    .max(150),
  razonSocial: z.string().trim().max(200).optional().nullable(),
  cuit: z.string().trim().max(30).optional().nullable(),
  condicionIva: z
    .enum(['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'])
    .default('responsable_inscripto'),
  iibb: z.string().trim().max(50).optional().nullable(),
  inicioActividades: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
    .optional()
    .nullable(),
  domicilioComercial: z.string().trim().max(300).optional().nullable(),
  telefono: z.string().trim().max(50).optional().nullable(),
  email: z
    .string()
    .trim()
    .email('Email inválido')
    .optional()
    .nullable()
    .or(z.literal('')),
  logoUrl: z.string().trim().max(15_000_000).optional().nullable(),
  leyendaTicket: z.string().trim().max(500).optional().nullable(),
});
export type GuardarDatosEmpresaInput = z.infer<
  typeof guardarDatosEmpresaSchema
>;

export interface DatosEmpresaItem {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  iibb: string | null;
  inicioActividades: string | null;
  domicilioComercial: string | null;
  telefono: string | null;
  email: string | null;
  logoUrl: string | null;
  leyendaTicket: string | null;
}

export const guardarUsuarioAdminSchema = z.object({
  id: uuidSchema.optional(),
  nombre: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100),
  email: z.string().trim().email('Email inválido').max(120),
  rol: rolUsuarioSchema,
  activo: z.boolean().default(true),
  password: z
    .string()
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(100)
    .optional(),
});
export type GuardarUsuarioAdminInput = z.infer<
  typeof guardarUsuarioAdminSchema
>;

export const cambiarPasswordAdminSchema = z.object({
  password: z
    .string()
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(100),
});
export type CambiarPasswordAdminInput = z.infer<
  typeof cambiarPasswordAdminSchema
>;

export interface UsuarioItemAdmin {
  id: string;
  negocioId: string;
  proveedorUid: string;
  nombre: string;
  email: string | null;
  rol: RolUsuario;
  activo: boolean;
  ultimoIngreso: string | null;
  creadoEn: string;
}

// -------------------------------------------------------------
// Fase 16: Control de Inventario Físico y Auditoría de Stock
// -------------------------------------------------------------

export const estadoInventarioSchema = z.enum([
  'en_proceso',
  'aplicado',
  'cancelado',
]);
export type EstadoInventario = z.infer<typeof estadoInventarioSchema>;

export const iniciarInventarioSchema = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  rubroId: uuidSchema.optional().nullable(),
  observaciones: z.string().trim().max(500).optional().nullable(),
});
export type IniciarInventarioInput = z.infer<typeof iniciarInventarioSchema>;

export const itemConteoInputSchema = z.object({
  productoId: uuidSchema,
  stockContado: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad válida (hasta 3 decimales)'),
  contadoPorNombre: z.string().trim().max(100).optional(),
});
export type ItemConteoInput = z.infer<typeof itemConteoInputSchema>;

export const guardarConteosInventarioSchema = z.object({
  items: z.array(itemConteoInputSchema).min(1, 'Debe incluir al menos un ítem contado'),
});
export type GuardarConteosInventarioInput = z.infer<
  typeof guardarConteosInventarioSchema
>;

export const aplicarInventarioSchema = z.object({
  observaciones: z.string().trim().max(500).optional(),
});
export type AplicarInventarioInput = z.infer<typeof aplicarInventarioSchema>;

export interface InventarioFisicoItem {
  id: string;
  numero: number;
  nombre: string;
  rubroId: string | null;
  rubroNombre: string | null;
  estado: EstadoInventario;
  totalArticulos: number;
  articulosConDiferencia: number;
  diferenciaNetaValorizada: string;
  observaciones: string | null;
  iniciadoPorNombre: string;
  aplicadoPorNombre: string | null;
  creadoEn: string;
  aplicadoEn: string | null;
}

export interface ItemInventarioDetalle {
  id: string;
  inventarioId: string;
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  rubroNombre: string | null;
  unidadPrincipal: string;
  stockSistema: string;
  stockContado: string | null;
  diferencia: string;
  costoUnitario: string;
  diferenciaValorizada: string;
  contadoEn: string | null;
  contadoPorNombre: string | null;
}

export interface DetalleInventarioFisico {
  inventario: InventarioFisicoItem;
  items: ItemInventarioDetalle[];
}

// -------------------------------------------------------------
// Fase 17A: Listas de Precios Múltiples y Reglas de Descuento por Volumen
// -------------------------------------------------------------

export const crearListaPrecioSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
  margenPct: comisionPctSchema,
  orden: z.number().int().min(1).max(100).optional().default(1),
  activo: z.boolean().optional().default(true),
});
export type CrearListaPrecioInput = z.infer<typeof crearListaPrecioSchema>;

export const fijarPrecioProductoListaSchema = z.object({
  productoId: uuidSchema,
  listaPrecioId: uuidSchema,
  precioFijo: montoNoNegativoSchema,
});
export type FijarPrecioProductoListaInput = z.infer<
  typeof fijarPrecioProductoListaSchema
>;

export const crearReglaVolumenSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre de la regla es obligatorio')
      .max(150),
    productoId: uuidSchema.optional().nullable(),
    rubroId: uuidSchema.optional().nullable(),
    listaPrecioId: uuidSchema.optional().nullable(),
    cantidadMinima: cantidadDecimalSchema,
    descuentoPct: comisionPctSchema,
    activo: z.boolean().optional().default(true),
  })
  .refine((data) => Boolean(data.productoId || data.rubroId), {
    message:
      'Debe especificar al menos un producto o un rubro para la regla de volumen',
    path: ['productoId'],
  });
export type CrearReglaVolumenInput = z.infer<typeof crearReglaVolumenSchema>;

export const actualizarReglaVolumenSchema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  productoId: uuidSchema.optional().nullable(),
  rubroId: uuidSchema.optional().nullable(),
  listaPrecioId: uuidSchema.optional().nullable(),
  cantidadMinima: cantidadDecimalSchema.optional(),
  descuentoPct: comisionPctSchema.optional(),
  activo: z.boolean().optional(),
});
export type ActualizarReglaVolumenInput = z.infer<
  typeof actualizarReglaVolumenSchema
>;

export interface ReglaDescuentoVolumenItem {
  id: string;
  nombre: string;
  productoId: string | null;
  productoCodigo: string | null;
  productoNombre: string | null;
  rubroId: string | null;
  rubroNombre: string | null;
  listaPrecioId: string | null;
  listaPrecioNombre: string | null;
  cantidadMinima: string;
  descuentoPct: string;
  activo: boolean;
  creadoEn: string;
}

export interface PrecioProductoListaItem {
  id: string;
  productoId: string;
  listaPrecioId: string;
  precioFijo: string;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Evalúa las reglas de volumen aplicables a un ítem según producto, rubro, lista de precio y cantidad.
 * Retorna la regla con mayor porcentaje de descuento si cumple la cantidad mínima.
 */
export function evaluarDescuentoVolumen(params: {
  productoId?: string | undefined;
  rubroId?: string | undefined;
  listaPrecioId?: string | undefined;
  cantidad: number;
  reglas: ReglaDescuentoVolumenItem[];
}): { descuentoPct: string; reglaNombre: string } | null {
  const { productoId, rubroId, listaPrecioId, cantidad, reglas } = params;
  if (reglas.length === 0 || cantidad <= 0) return null;

  let mejorRegla: ReglaDescuentoVolumenItem | null = null;
  let mejorDescuentoNum = 0;

  for (const r of reglas) {
    if (!r.activo) continue;

    // Si la regla restringe a una lista de precio específica y no coincide, saltar
    if (r.listaPrecioId && listaPrecioId && r.listaPrecioId !== listaPrecioId) {
      continue;
    }

    // Coincidencia por producto específico
    const coincideProducto = Boolean(productoId && r.productoId === productoId);
    // Coincidencia por rubro (si la regla no tiene producto específico)
    const coincideRubro = Boolean(!r.productoId && rubroId && r.rubroId === rubroId);

    if (!coincideProducto && !coincideRubro) continue;

    const cantMinima = parseFloat(r.cantidadMinima);
    if (cantidad >= cantMinima) {
      const descPct = parseFloat(r.descuentoPct);
      // Prioridad 1: Coincidencia por producto tiene prioridad sobre rubro general
      // Prioridad 2: Mayor porcentaje de descuento
      const esMejorEspecificidad =
        coincideProducto && mejorRegla && !mejorRegla.productoId;
      if (descPct > mejorDescuentoNum || esMejorEspecificidad) {
        mejorDescuentoNum = descPct;
        mejorRegla = r;
      }
    }
  }

  if (!mejorRegla || mejorDescuentoNum <= 0) return null;

  return {
    descuentoPct: mejorRegla.descuentoPct,
    reglaNombre: mejorRegla.nombre,
  };
}

// -------------------------------------------------------------
// Fase 17B: Sugerencia Inteligente de Reabastecimiento y Órdenes de Compra Automáticas
// -------------------------------------------------------------

export const nivelUrgenciaReabastecimientoSchema = z.enum([
  'quiebre',
  'critico',
  'preventivo',
  'normal',
]);
export type NivelUrgenciaReabastecimiento = z.infer<
  typeof nivelUrgenciaReabastecimientoSchema
>;

export interface SugerenciaReabastecimientoItem {
  productoId: string;
  codigo: string;
  nombre: string;
  unidadPrincipal: string;
  rubroNombre: string | null;
  stockActual: string;
  stockMinimo: string;
  puntoPedido: string;
  leadTimeDias: number;
  costoBase: string;
  unidadesVendidas30d: string;
  consumoDiarioPromedio: string;
  diasAutonomia: number;
  puntoPedidoEfectivo: string;
  cantidadSugerida: string;
  proveedorId: string | null;
  proveedorNombre: string | null;
  costoCompraEstimado: string;
  nivelUrgencia: NivelUrgenciaReabastecimiento;
}

export const itemGenerarOrdenReabastecimientoSchema = z.object({
  productoId: uuidSchema,
  cantidad: cantidadDecimalSchema,
  costoUnitario: montoNoNegativoSchema,
});
export type ItemGenerarOrdenReabastecimientoInput = z.infer<
  typeof itemGenerarOrdenReabastecimientoSchema
>;

export const ordenProveedorInputSchema = z.object({
  proveedorId: uuidSchema,
  condicionPago: z
    .enum(['contado', 'cuenta_corriente'])
    .default('cuenta_corriente'),
  items: z
    .array(itemGenerarOrdenReabastecimientoSchema)
    .min(1, 'Debe incluir al menos un producto a pedir'),
  notas: z.string().trim().max(500).optional(),
});
export type OrdenProveedorInput = z.infer<typeof ordenProveedorInputSchema>;

export const generarOrdenesReabastecimientoSchema = z.object({
  ordenes: z
    .array(ordenProveedorInputSchema)
    .min(1, 'Debe incluir al menos una orden de compra'),
});
export type GenerarOrdenesReabastecimientoInput = z.infer<
  typeof generarOrdenesReabastecimientoSchema
>;

export interface OrdenCompraGeneradaInfo {
  id: string;
  numero: string;
  proveedorId: string;
  proveedorNombre: string;
  total: string;
  cantidadItems: number;
}

export interface GenerarOrdenesReabastecimientoResponse {
  ok: boolean;
  ordenesCreadas: OrdenCompraGeneradaInfo[];
  mensaje: string;
}

// -------------------------------------------------------------
// Fase 18: Acopio de Materiales y Entregas Parciales (Venta Acopiada)
// -------------------------------------------------------------
export const itemCrearAcopioSchema = z.object({
  productoId: uuidSchema,
  cantidad: cantidadDecimalSchema,
  precioUnitario: montoNoNegativoSchema,
});
export type ItemCrearAcopioInput = z.infer<typeof itemCrearAcopioSchema>;

export const crearAcopioSchema = z.object({
  clienteId: uuidSchema,
  ventaId: uuidSchema.optional().nullable(),
  fechaEmision: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
    .optional(),
  notas: z.string().trim().max(500).optional().nullable(),
  items: z
    .array(itemCrearAcopioSchema)
    .min(1, 'El acopio debe tener al menos un artículo'),
});
export type CrearAcopioInput = z.infer<typeof crearAcopioSchema>;

export const itemEntregaAcopioSchema = z.object({
  itemAcopioId: uuidSchema,
  productoId: uuidSchema,
  cantidad: cantidadDecimalSchema,
});
export type ItemEntregaAcopioInput = z.infer<typeof itemEntregaAcopioSchema>;

export const registrarEntregaAcopioSchema = z.object({
  retiradoPorNombre: z.string().trim().min(2, 'Indique el nombre de quien retira'),
  retiradoPorDni: z.string().trim().max(30).optional().nullable(),
  vehiculoPatente: z.string().trim().max(20).optional().nullable(),
  observaciones: z.string().trim().max(500).optional().nullable(),
  items: z
    .array(itemEntregaAcopioSchema)
    .min(1, 'Debe entregar al menos un producto'),
});
export type RegistrarEntregaAcopioInput = z.infer<
  typeof registrarEntregaAcopioSchema
>;

export interface AcopioResumenItem {
  id: string;
  numero: string;
  estado: 'activo' | 'completado' | 'cancelado';
  fechaEmision: string;
  clienteId: string;
  clienteNombre: string;
  clienteCuitDni: string | null;
  clienteTelefono: string | null;
  ventaId: string | null;
  notas: string | null;
  creadoPor: string;
  creadoEn: string;
  totalArticulos: number;
  totalUnidadesCompradas: string;
  totalUnidadesEntregadas: string;
  saldoUnidadesPendientes: string;
  totalValorizado: string;
  pctEntregado: number;
}

export interface ItemAcopioDetalle {
  id: string;
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadPrincipal: string;
  cantidadComprada: string;
  cantidadEntregada: string;
  saldoPendiente: string;
  precioUnitario: string;
  subtotal: string;
  stockActualDeposito: string;
}

export interface RemitoEntregaItemDetalle {
  id: string;
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadPrincipal: string;
  cantidad: string;
}

export interface RemitoEntregaDetalle {
  id: string;
  numero: string;
  fecha: string;
  retiradoPorNombre: string;
  retiradoPorDni: string | null;
  vehiculoPatente: string | null;
  observaciones: string | null;
  creadoPor: string;
  items: RemitoEntregaItemDetalle[];
}

export interface AcopioDetalleCompleto {
  acopio: AcopioResumenItem;
  items: ItemAcopioDetalle[];
  remitos: RemitoEntregaDetalle[];
}

// -------------------------------------------------------------
// Fase 19 — Actualizador Masivo de Precios
// -------------------------------------------------------------

export const reglaRedondeoPreciosSchema = z.enum([
  'ninguno',
  'entero',
  'multiplo_10',
  'multiplo_50',
  'multiplo_100',
]);
export type ReglaRedondeoPrecios = z.infer<typeof reglaRedondeoPreciosSchema>;

export const baseActualizacionPrecioSchema = z.enum([
  'costo_base',
  'precio_venta',
]);
export type BaseActualizacionPrecio = z.infer<
  typeof baseActualizacionPrecioSchema
>;

export const actualizarPreciosPorcentajeSchema = z.object({
  porcentaje: z
    .number()
    .min(-99, 'El porcentaje no puede ser menor a -99%')
    .max(500, 'El porcentaje no puede ser mayor a +500%'),
  base: baseActualizacionPrecioSchema.default('costo_base'),
  rubroId: uuidSchema.optional().nullable(),
  proveedorId: uuidSchema.optional().nullable(),
  redondeo: reglaRedondeoPreciosSchema.default('ninguno'),
});
export type ActualizarPreciosPorcentajeInput = z.infer<
  typeof actualizarPreciosPorcentajeSchema
>;

export const itemActualizacionProveedorSchema = z.object({
  identificador: z.string().trim().min(1, 'El código es obligatorio'),
  nuevoCosto: montoPositivoSchema,
});
export type ItemActualizacionProveedor = z.infer<
  typeof itemActualizacionProveedorSchema
>;

export const actualizarPreciosListaProveedorSchema = z.object({
  proveedorId: uuidSchema.optional().nullable(),
  items: z
    .array(itemActualizacionProveedorSchema)
    .min(1, 'Debe incluir al menos un artículo'),
  redondeo: reglaRedondeoPreciosSchema.default('ninguno'),
});
export type ActualizarPreciosListaProveedorInput = z.infer<
  typeof actualizarPreciosListaProveedorSchema
>;

export interface PrevisualizacionPrecioItem {
  productoId: string;
  codigo: string;
  nombre: string;
  rubroNombre: string | null;
  costoActual: string;
  costoNuevo: string;
  precioVentaActual: string;
  precioVentaNuevo: string;
  diferenciaMonto: string;
  diferenciaPct: number;
}

export interface ResultadoActualizacionPrecios {
  totalArticulosModificados: number;
  porcentajeAplicado?: number | undefined;
  baseModificada: string;
  mensaje: string;
}

/**
 * Aplica una regla de redondeo comercial a un importe expresado como string decimal.
 * Respeta la regla 3 de AGENTS.md operando en centavos enteros con BigInt.
 */
export function aplicarRedondeoPrecio(
  monto: string,
  regla: ReglaRedondeoPrecios,
): string {
  const centavos = aCentavos(monto);
  if (regla === 'ninguno' || centavos <= 0n) {
    return monto;
  }

  let baseCentavos = 100n; // 'entero' = $1.00 = 100 centavos
  if (regla === 'multiplo_10') {
    baseCentavos = 1000n; // $10.00
  } else if (regla === 'multiplo_50') {
    baseCentavos = 5000n; // $50.00
  } else if (regla === 'multiplo_100') {
    baseCentavos = 10000n; // $100.00
  }

  // Redondeo aritmético: round(centavos / base) * base
  const resto = centavos % baseCentavos;
  const mitad = baseCentavos / 2n;
  const redondeado =
    resto >= mitad
      ? centavos + (baseCentavos - resto)
      : centavos - resto;

  return deCentavos(redondeado > 0n ? redondeado : baseCentavos);
}

// -------------------------------------------------------------
// Fase 20 — Logística de Envíos, Despachos y Hoja de Ruta
// -------------------------------------------------------------

export const estadoDespachoSchema = z.enum([
  'pendiente',
  'en_camino',
  'entregado',
  'fallido',
  'cancelado',
]);
export type EstadoDespacho = z.infer<typeof estadoDespachoSchema>;

export const estadoHojaRutaSchema = z.enum([
  'en_preparacion',
  'en_viaje',
  'finalizada',
  'cancelada',
]);
export type EstadoHojaRuta = z.infer<typeof estadoHojaRutaSchema>;

export const estadoParadaSchema = z.enum([
  'pendiente',
  'entregado',
  'no_entregado',
]);
export type EstadoParada = z.infer<typeof estadoParadaSchema>;

export const crearDespachoEnvioSchema = z.object({
  clienteId: uuidSchema,
  ventaId: uuidSchema.optional().nullable(),
  remitoAcopioId: uuidSchema.optional().nullable(),
  direccionDestino: z.string().trim().min(3, 'La dirección es obligatoria'),
  localidad: z.string().trim().max(100).optional().nullable(),
  contactoNombre: z
    .string()
    .trim()
    .min(2, 'El nombre de contacto es obligatorio'),
  contactoTelefono: z.string().trim().max(50).optional().nullable(),
  franjaHoraria: z.string().trim().max(100).optional().nullable(),
  costoFlete: montoNoNegativoSchema.default('0.00'),
  notasDespacho: z.string().trim().max(500).optional().nullable(),
});
export type CrearDespachoEnvioInput = z.infer<typeof crearDespachoEnvioSchema>;

export const cambiarEstadoDespachoSchema = z.object({
  estado: estadoDespachoSchema,
  motivoFallo: z.string().trim().max(500).optional().nullable(),
});
export type CambiarEstadoDespachoInput = z.infer<
  typeof cambiarEstadoDespachoSchema
>;

export const crearHojaRutaSchema = z.object({
  fechaSalida: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD')
    .optional(),
  fleteroNombre: z
    .string()
    .trim()
    .min(2, 'El nombre del fletero es obligatorio'),
  fleteroTelefono: z.string().trim().max(50).optional().nullable(),
  vehiculoPatente: z.string().trim().max(20).optional().nullable(),
  observaciones: z.string().trim().max(500).optional().nullable(),
  despachosIds: z
    .array(uuidSchema)
    .min(1, 'Debe incluir al menos un despacho en la hoja de ruta'),
});
export type CrearHojaRutaInput = z.infer<typeof crearHojaRutaSchema>;

export const cambiarEstadoHojaRutaSchema = z.object({
  estado: estadoHojaRutaSchema,
});
export type CambiarEstadoHojaRutaInput = z.infer<
  typeof cambiarEstadoHojaRutaSchema
>;

export const registrarEntregaParadaSchema = z.object({
  estadoParada: z.enum(['entregado', 'no_entregado']),
  observacionesEntrega: z.string().trim().max(500).optional().nullable(),
});
export type RegistrarEntregaParadaInput = z.infer<
  typeof registrarEntregaParadaSchema
>;

export interface DespachoEnvioResumen {
  id: string;
  numero: string;
  ventaId: string | null;
  remitoAcopioId: string | null;
  clienteId: string;
  clienteNombre: string;
  clienteCuitDni: string | null;
  direccionDestino: string;
  localidad: string | null;
  contactoNombre: string;
  contactoTelefono: string | null;
  franjaHoraria: string | null;
  costoFlete: string;
  estado: EstadoDespacho;
  notasDespacho: string | null;
  motivoFallo: string | null;
  creadoPor: string;
  creadoEn: string;
  entregadoEn: string | null;
  hojaRutaId: string | null;
  hojaRutaNumero: string | null;
  fleteroNombre: string | null;
  vehiculoPatente: string | null;
  ordenParada: number | null;
}

export interface ItemHojaRutaDetalle {
  id: string;
  despachoId: string;
  despachoNumero: string;
  clienteNombre: string;
  direccionDestino: string;
  localidad: string | null;
  contactoNombre: string;
  contactoTelefono: string | null;
  ordenParada: number;
  estadoParada: EstadoParada;
  entregadoEn: string | null;
  observacionesEntrega: string | null;
}

export interface HojaRutaDetalleCompleto {
  id: string;
  numero: string;
  fechaSalida: string;
  fleteroNombre: string;
  fleteroTelefono: string | null;
  vehiculoPatente: string | null;
  estado: EstadoHojaRuta;
  observaciones: string | null;
  creadoPor: string;
  creadoEn: string;
  cerradaEn: string | null;
  totalParadas: number;
  paradasEntregadas: number;
  paradas: ItemHojaRutaDetalle[];
}

// ============================================================================
// Enlaces y Formateo para Mensajería WhatsApp
// ============================================================================

/**
 * Normaliza un número telefónico a formato internacional E.164 sin '+' para wa.me.
 * Limpia espacios, paréntesis, guiones y barras.
 * Soporta números de Argentina (prefijos 0, 15, o directos de 10 dígitos -> 549...).
 */
export function normalizarTelefonoWhatsApp(telefono: string): string {
  let digitos = telefono.replace(/\D/g, '');

  if (!digitos) return '';

  if (digitos.startsWith('00')) {
    digitos = digitos.slice(2);
  }

  if (digitos.startsWith('54')) {
    if (digitos.startsWith('549')) {
      return digitos;
    }
    if (digitos.startsWith('540')) {
      digitos = '54' + digitos.slice(3);
    }
    return '549' + digitos.slice(2);
  }

  if (digitos.startsWith('0')) {
    digitos = digitos.slice(1);
  }

  // Quita el prefijo '15' típico de móviles argentinos: área (2 a 4 dígitos) + 15 + local (6 a 8 dígitos)
  const match15 = digitos.match(/^(\d{2,4})15(\d{6,8})$/);
  if (match15 && match15[1] && match15[2]) {
    digitos = match15[1] + match15[2];
  }

  if (digitos.length === 10) {
    return '549' + digitos;
  }

  if (digitos.length >= 8 && digitos.length <= 11) {
    return '549' + digitos;
  }

  return digitos;
}

/**
 * Genera el enlace wa.me para abrir WhatsApp Web o la App móvil
 */
export function generarLinkWhatsApp(telefono: string, mensaje: string): string {
  const telLimpio = normalizarTelefonoWhatsApp(telefono);
  const textoCodificado = encodeURIComponent(mensaje);
  if (!telLimpio) {
    return `https://wa.me/?text=${textoCodificado}`;
  }
  return `https://wa.me/${telLimpio}?text=${textoCodificado}`;
}

export interface DatosMensajeWhatsAppTicket {
  nombreNegocio: string;
  nombreCliente?: string | null;
  numeroTicket: string | number;
  totalPesos: string;
  medioCobro?: string | null;
  cantidadArticulos?: number;
  piePersonalizado?: string;
}

export function formatearMensajeTicket(datos: DatosMensajeWhatsAppTicket): string {
  const cliente =
    datos.nombreCliente && datos.nombreCliente.trim().toLowerCase() !== 'consumidor final'
      ? `Hola *${datos.nombreCliente.trim()}*`
      : '¡Hola!';

  let msg = `${cliente}, te enviamos el comprobante de tu compra en *${datos.nombreNegocio.trim()}* 🛠️\n\n`;
  msg += `🧾 *Comprobante #${datos.numeroTicket}*\n`;
  if (datos.cantidadArticulos) {
    msg += `📦 Artículos: *${datos.cantidadArticulos}*\n`;
  }
  if (datos.medioCobro) {
    msg += `💳 Pago: *${datos.medioCobro}*\n`;
  }
  msg += `💵 Total: *${datos.totalPesos}*\n\n`;
  if (datos.piePersonalizado) {
    msg += `${datos.piePersonalizado}\n\n`;
  }
  msg += '¡Muchas gracias por elegirnos!';
  return msg;
}

export interface DatosMensajeWhatsAppCtaCte {
  nombreNegocio: string;
  nombreCliente: string;
  saldoPesos: string;
  limitePesos?: string | null;
  aliasCbu?: string | null;
  cbu?: string | null;
}

export function formatearMensajeCtaCte(datos: DatosMensajeWhatsAppCtaCte): string {
  let msg = `Hola *${datos.nombreCliente.trim()}*, te escribimos de *${datos.nombreNegocio.trim()}* 📋\n\n`;
  msg += `Te compartimos el estado actualizado de tu cuenta corriente:\n`;
  msg += `💰 Saldo pendiente: *${datos.saldoPesos}*\n`;
  if (datos.limitePesos) {
    msg += `📊 Límite de crédito asignado: *${datos.limitePesos}*\n`;
  }
  if (datos.aliasCbu || datos.cbu) {
    msg += `\n*Datos para transferencia:*\n`;
    if (datos.aliasCbu) msg += `🔹 Alias: *${datos.aliasCbu}*\n`;
    if (datos.cbu) msg += `🔹 CBU: *${datos.cbu}*\n`;
  }
  msg += `\nAnte cualquier consulta o para enviarnos el comprobante de pago, podés responder por este medio.\n¡Saludos cordiales!`;
  return msg;
}

export interface DatosMensajeWhatsAppPresupuesto {
  nombreNegocio: string;
  nombreCliente?: string | null;
  numeroPresupuesto: string;
  totalPesos: string;
  diasValidez: number;
}

export function formatearMensajePresupuesto(datos: DatosMensajeWhatsAppPresupuesto): string {
  const cliente = datos.nombreCliente ? `Hola *${datos.nombreCliente.trim()}*` : '¡Hola!';
  let msg = `${cliente}, te enviamos el presupuesto solicitado en *${datos.nombreNegocio.trim()}* 📄\n\n`;
  msg += `📋 *Presupuesto #${datos.numeroPresupuesto}*\n`;
  msg += `💵 Total: *${datos.totalPesos}*\n`;
  msg += `⏳ Validez: *${datos.diasValidez} días*\n\n`;
  msg += `Quedamos a tu entera disposición por cualquier duda o para coordinar la entrega.\n¡Muchas gracias!`;
  return msg;
}

export interface DatosMensajeWhatsAppDespacho {
  nombreNegocio: string;
  nombreCliente: string;
  numeroDespacho: string;
  direccionDestino: string;
  fleteroNombre?: string | null;
  fleteroTelefono?: string | null;
  cobroEnDestinoPesos?: string | null;
}

export function formatearMensajeDespacho(datos: DatosMensajeWhatsAppDespacho): string {
  let msg = `Hola *${datos.nombreCliente.trim()}*, te avisamos de *${datos.nombreNegocio.trim()}* que tu pedido está en camino 🚚💨\n\n`;
  msg += `📦 *Despacho #${datos.numeroDespacho}*\n`;
  msg += `📍 Destino: *${datos.direccionDestino}*\n`;
  if (datos.fleteroNombre) {
    msg += `👤 Fletero asignado: *${datos.fleteroNombre}*`;
    if (datos.fleteroTelefono) {
      msg += ` (Tel: ${datos.fleteroTelefono})`;
    }
    msg += `\n`;
  }
  if (datos.cobroEnDestinoPesos) {
    msg += `💵 Importe a abonar en destino: *${datos.cobroEnDestinoPesos}*\n`;
  }
  msg += `\nTe solicitamos tener personal disponible para la recepción y descarga.\n¡Muchas gracias!`;
  return msg;
}

export interface DatosMensajeWhatsAppOrdenCompra {
  nombreNegocio: string;
  nombreProveedor: string;
  numeroOrden: string;
  cantidadArticulos: number;
}

export function formatearMensajeOrdenCompra(datos: DatosMensajeWhatsAppOrdenCompra): string {
  let msg = `Hola estimado/a *${datos.nombreProveedor.trim()}*, le escribimos de *${datos.nombreNegocio.trim()}* 📦\n\n`;
  msg += `Le adjuntamos el pedido de compra *#${datos.numeroOrden}* con un total de *${datos.cantidadArticulos}* ítems solicitados.\n\n`;
  msg += `Agradecemos confirmación de stock, plazos de entrega y factura correspondiente.\n¡Muchas gracias!`;
  return msg;
}

// ============================================================================
// Fase 22: Múltiples Depósitos y Transferencias Internas de Stock
// ============================================================================

export const estadoTransferenciaStockSchema = z.enum([
  'pendiente',
  'en_transito',
  'completada',
  'cancelada',
]);
export type EstadoTransferenciaStock = z.infer<typeof estadoTransferenciaStockSchema>;

export const crearDepositoSchema = z.object({
  nombre: z.string().min(1, 'El nombre del depósito es obligatorio'),
  codigo: z.string().min(1, 'El código del depósito es obligatorio'),
  direccion: z.string().optional().nullable(),
  esPrincipal: z.boolean().optional().default(false),
});
export type CrearDepositoInput = z.infer<typeof crearDepositoSchema>;

export const actualizarDepositoSchema = z.object({
  nombre: z.string().min(1).optional(),
  direccion: z.string().optional().nullable(),
  esPrincipal: z.boolean().optional(),
  activo: z.boolean().optional(),
});
export type ActualizarDepositoInput = z.infer<typeof actualizarDepositoSchema>;

export const itemTransferenciaInputSchema = z.object({
  productoId: z.string().uuid('ID de producto inválido'),
  cantidad: cantidadDecimalSchema,
  unidad: z.string().min(1),
  cantidadBase: cantidadDecimalSchema,
  notas: z.string().optional().nullable(),
});
export type ItemTransferenciaInput = z.infer<typeof itemTransferenciaInputSchema>;

export const crearTransferenciaStockSchema = z
  .object({
    depositoOrigenId: z.string().uuid('Depósito de origen requerido'),
    depositoDestinoId: z.string().uuid('Depósito de destino requerido'),
    motivo: z.string().optional().nullable(),
    observaciones: z.string().optional().nullable(),
    items: z.array(itemTransferenciaInputSchema).min(1, 'Debe incluir al menos un artículo a transferir'),
  })
  .refine((data) => data.depositoOrigenId !== data.depositoDestinoId, {
    message: 'El depósito de origen y destino no pueden ser el mismo',
    path: ['depositoDestinoId'],
  });
export type CrearTransferenciaStockInput = z.infer<typeof crearTransferenciaStockSchema>;

export interface DepositoItem {
  id: string;
  nombre: string;
  codigo: string;
  direccion: string | null;
  esPrincipal: boolean;
  activo: boolean;
  creadoEn: string;
}

export interface StockPorDepositoItem {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  productoMarca: string | null;
  unidadPrincipal: string;
  depositoId: string;
  depositoCodigo: string;
  depositoNombre: string;
  stockActualBase: string;
}

export interface TransferenciaStockResumen {
  id: string;
  numero: string;
  depositoOrigenId: string;
  depositoOrigenNombre: string;
  depositoDestinoId: string;
  depositoDestinoNombre: string;
  estado: EstadoTransferenciaStock;
  motivo: string | null;
  observaciones: string | null;
  creadoPor: string;
  creadoEn: string;
  completadoEn: string | null;
  totalArticulos: number;
}

export interface ItemTransferenciaStockDetalle {
  id: string;
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  cantidad: string;
  unidad: string;
  cantidadBase: string;
  notas: string | null;
}

export interface TransferenciaStockCompleta {
  id: string;
  numero: string;
  depositoOrigenId: string;
  depositoOrigenNombre: string;
  depositoDestinoId: string;
  depositoDestinoNombre: string;
  estado: EstadoTransferenciaStock;
  motivo: string | null;
  observaciones: string | null;
  creadoPor: string;
  creadoEn: string;
  completadoEn: string | null;
  items: ItemTransferenciaStockDetalle[];
}
