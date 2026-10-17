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
});
export type ItemVentaInput = z.infer<typeof itemVentaInputSchema>;

export const registrarVentaSchema = z
  .object({
    id: uuidSchema,
    turnoId: uuidSchema,
    clienteId: uuidSchema.optional(),
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


