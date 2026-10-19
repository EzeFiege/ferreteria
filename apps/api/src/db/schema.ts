import {
  boolean,
  date,
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
  codigo: text('codigo').notNull(),
  nombre: text('nombre').notNull(),
  cuitDni: text('cuit_dni'),
  documento: text('documento'),
  condicionIva: text('condicion_iva')
    .$type<
      'consumidor_final' | 'responsable_inscripto' | 'monotributo' | 'exento'
    >()
    .notNull()
    .default('consumidor_final'),
  telefono: text('telefono'),
  email: text('email'),
  direccion: text('direccion'),
  listaPrecioId: uuid('lista_precio_id'),
  limiteCredito: numeric('limite_credito', { precision: 14, scale: 2 })
    .notNull()
    .default('0.00'),
  diasPlazoCredito: integer('dias_plazo_credito').notNull().default(30),
  activo: boolean('activo').notNull().default(true),
  notas: text('notas'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const clienteAutorizado = pgTable('cliente_autorizado', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  clienteId: uuid('cliente_id').notNull(),
  nombre: text('nombre').notNull(),
  dni: text('dni'),
  rolParentesco: text('rol_parentesco'),
  telefono: text('telefono'),
  activo: boolean('activo').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
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
  autorizadoRetiroId: uuid('autorizado_retiro_id'),
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

export const listaPrecio = pgTable('lista_precio', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  margenPct: numeric('margen_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('0.00'),
  activo: boolean('activo').notNull().default(true),
  orden: integer('orden').notNull().default(1),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const producto = pgTable('producto', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  rubroId: uuid('rubro_id'),
  codigo: text('codigo').notNull(),
  nombre: text('nombre').notNull(),
  marca: text('marca'),
  descripcion: text('descripcion'),
  imagenUrl: text('imagen_url'),
  codigoQr: text('codigo_qr'),
  costoBase: numeric('costo_base', { precision: 14, scale: 2 })
    .notNull()
    .default('0.00'),
  unidadPrincipal: text('unidad_principal').notNull().default('un'),
  unidadSecundaria: text('unidad_secundaria'),
  factorConversion: numeric('factor_conversion', { precision: 14, scale: 3 })
    .notNull()
    .default('1.000'),
  permiteFraccion: boolean('permite_fraccion').notNull().default(false),
  stockMinimo: numeric('stock_minimo', { precision: 14, scale: 3 })
    .notNull()
    .default('0.000'),
  activo: boolean('activo').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const productoCodigoBarra = pgTable('producto_codigo_barra', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  codigoBarra: text('codigo_barra').notNull(),
  esPrincipal: boolean('es_principal').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const movimientoStock = pgTable('movimiento_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  turnoId: uuid('turno_id'),
  ventaId: uuid('venta_id'),
  tipo: text('tipo')
    .$type<
      | 'ingreso_compra'
      | 'egreso_venta'
      | 'ajuste_sobrante'
      | 'ajuste_faltante'
      | 'merma_rotura'
      | 'devolucion'
    >()
    .notNull(),
  sentido: text('sentido').$type<'in' | 'out'>().notNull(),
  cantidad: numeric('cantidad', { precision: 14, scale: 3 }).notNull(),
  unidad: text('unidad').notNull(),
  cantidadBase: numeric('cantidad_base', { precision: 14, scale: 3 }).notNull(),
  costoUnitario: numeric('costo_unitario', { precision: 14, scale: 2 })
    .notNull()
    .default('0.00'),
  notas: text('notas'),
  revierteId: uuid('revierte_id'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const movimientoCtaCte = pgTable('movimiento_cta_cte', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  clienteId: uuid('cliente_id').notNull(),
  tipo: text('tipo')
    .$type<
      'debito_venta' | 'credito_cobranza' | 'ajuste_debito' | 'ajuste_credito'
    >()
    .notNull(),
  sentido: text('sentido').$type<'debito' | 'credito'>().notNull(),
  monto: numeric('monto', { precision: 14, scale: 2 }).notNull(),
  ventaId: uuid('venta_id'),
  movimientoCajaId: uuid('movimiento_caja_id'),
  autorizadoRetiroId: uuid('autorizado_retiro_id'),
  descripcion: text('descripcion'),
  revierteId: uuid('revierte_id'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const proveedor = pgTable('proveedor', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  codigo: text('codigo').notNull(),
  razonSocial: text('razon_social').notNull(),
  nombreFantasia: text('nombre_fantasia'),
  cuit: text('cuit'),
  condicionIva: text('condicion_iva').notNull().default('responsable_inscripto'),
  telefono: text('telefono'),
  email: text('email'),
  direccion: text('direccion'),
  contactoNombre: text('contacto_nombre'),
  diasPlazoPago: integer('dias_plazo_pago').notNull().default(30),
  activo: boolean('activo').notNull().default(true),
  notas: text('notas'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const productoProveedor = pgTable('producto_proveedor', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  proveedorId: uuid('proveedor_id').notNull(),
  codigoProveedor: text('codigo_proveedor'),
  costoProveedor: numeric('costo_proveedor', { precision: 14, scale: 2 }).notNull(),
  esPrincipal: boolean('es_principal').notNull().default(false),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const ordenCompra = pgTable('orden_compra', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  numero: text('numero').notNull(),
  proveedorId: uuid('proveedor_id').notNull(),
  estado: text('estado')
    .$type<'borrador' | 'confirmada' | 'recibida' | 'anulada'>()
    .notNull()
    .default('borrador'),
  condicionPago: text('condicion_pago')
    .$type<'contado' | 'cuenta_corriente'>()
    .notNull()
    .default('cuenta_corriente'),
  fechaEmision: date('fecha_emision').notNull().defaultNow(),
  fechaEsperada: date('fecha_esperada'),
  fechaRecepcion: timestamp('fecha_recepcion', { withTimezone: true }),
  total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0.00'),
  notas: text('notas'),
  creadoPor: uuid('creado_por').notNull(),
  recibidoPor: uuid('recibido_por'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const itemOrdenCompra = pgTable('item_orden_compra', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  ordenCompraId: uuid('orden_compra_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  descripcion: text('descripcion').notNull(),
  cantidadPedida: numeric('cantidad_pedida', { precision: 14, scale: 3 }).notNull(),
  cantidadRecibida: numeric('cantidad_recibida', { precision: 14, scale: 3 })
    .notNull()
    .default('0.000'),
  costoUnitario: numeric('costo_unitario', { precision: 14, scale: 2 }).notNull(),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
});

export const movimientoCtaCteProveedor = pgTable('movimiento_cta_cte_proveedor', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  proveedorId: uuid('proveedor_id').notNull(),
  tipo: text('tipo')
    .$type<'debito_compra' | 'credito_pago' | 'ajuste_debito' | 'ajuste_credito'>()
    .notNull(),
  sentido: text('sentido').$type<'debito' | 'credito'>().notNull(),
  monto: numeric('monto', { precision: 14, scale: 2 }).notNull(),
  ordenCompraId: uuid('orden_compra_id'),
  movimientoCajaId: uuid('movimiento_caja_id'),
  descripcion: text('descripcion'),
  revierteId: uuid('revierte_id'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});


