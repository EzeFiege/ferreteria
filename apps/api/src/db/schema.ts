import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const negocio = pgTable('negocio', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const sucursal = pgTable('sucursal', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
});

export const caja = pgTable('caja', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  sucursalId: uuid('sucursal_id').notNull(),
  nombre: text('nombre').notNull(),
});

export const usuario = pgTable('usuario', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  proveedorUid: text('proveedor_uid').notNull(),
  nombre: text('nombre').notNull(),
  rol: text('rol').$type<'dueno' | 'encargado' | 'cajero'>().notNull(),
  activo: boolean('activo').notNull().default(true),
});

export const medioPago = pgTable('medio_pago', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  esEfectivo: boolean('es_efectivo').notNull().default(false),
  diasAcreditacion: integer('dias_acreditacion').notNull().default(0),
  comisionPct: numeric('comision_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('0.00'),
  activo: boolean('activo').notNull().default(true),
});

export const rubro = pgTable('rubro', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
});

export const categoria = pgTable('categoria', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  tipo: text('tipo').$type<'ingreso' | 'egreso'>().notNull(),
});

export const cliente = pgTable('cliente', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  documento: text('documento'),
  telefono: text('telefono'),
  activo: boolean('activo').notNull().default(true),
});

export const turnoCaja = pgTable('turno_caja', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  cajaId: uuid('caja_id').notNull(),
  abiertoPor: uuid('abierto_por').notNull(),
  abreEn: timestamp('abre_en', { withTimezone: true }).notNull().defaultNow(),
  efectivoInicial: numeric('efectivo_inicial', {
    precision: 14,
    scale: 2,
  }).notNull(),
  cerradoPor: uuid('cerrado_por'),
  cierraEn: timestamp('cierra_en', { withTimezone: true }),
  efectivoContado: numeric('efectivo_contado', { precision: 14, scale: 2 }),
  notas: text('notas'),
});

export const venta = pgTable('venta', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  turnoId: uuid('turno_id').notNull(),
  clienteId: uuid('cliente_id'),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
  estado: text('estado')
    .$type<'confirmada' | 'anulada'>()
    .notNull()
    .default('confirmada'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const ventaItem = pgTable('venta_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  ventaId: uuid('venta_id').notNull(),
  productoId: uuid('producto_id'),
  descripcion: text('descripcion').notNull(),
  cantidad: numeric('cantidad', { precision: 14, scale: 3 }).notNull(),
  precioUnit: numeric('precio_unit', { precision: 14, scale: 2 }).notNull(),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }),
});

/**
 * Regla 1 de AGENTS.md: `movimiento` es un libro de solo agregar.
 * Nunca UPDATE ni DELETE.
 */
export const movimiento = pgTable('movimiento', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  turnoId: uuid('turno_id').notNull(),
  tipo: text('tipo')
    .$type<'venta' | 'egreso' | 'retiro' | 'ingreso_extra' | 'ajuste'>()
    .notNull(),
  sentido: text('sentido').$type<'in' | 'out'>().notNull(),
  monto: numeric('monto', { precision: 14, scale: 2 }).notNull(),
  medioPagoId: uuid('medio_pago_id').notNull(),
  rubroId: uuid('rubro_id'),
  categoriaId: uuid('categoria_id'),
  ventaId: uuid('venta_id'),
  descripcion: text('descripcion'),
  revierteId: uuid('revierte_id'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});
