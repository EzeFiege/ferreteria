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
  razonSocial: text('razon_social'),
  cuit: text('cuit'),
  condicionIva: text('condicion_iva').notNull().default('responsable_inscripto'),
  iibb: text('iibb'),
  inicioActividades: date('inicio_actividades'),
  domicilioComercial: text('domicilio_comercial'),
  telefono: text('telefono'),
  email: text('email'),
  logoUrl: text('logo_url'),
  leyendaTicket: text('leyenda_ticket'),
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
  email: text('email'),
  passwordHash: text('password_hash'),
  ultimoIngreso: timestamp('ultimo_ingreso', { withTimezone: true }),
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
  puntoPedido: numeric('punto_pedido', { precision: 14, scale: 3 })
    .notNull()
    .default('0.000'),
  leadTimeDias: integer('lead_time_dias').notNull().default(7),
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

export const chequeCartera = pgTable('cheque_cartera', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  tipo: text('tipo').$type<'fisico' | 'echeq'>().notNull().default('fisico'),
  numero: text('numero').notNull(),
  banco: text('banco').notNull(),
  cuitEmisor: text('cuit_emisor'),
  titular: text('titular'),
  fechaEmision: date('fecha_emision').notNull().defaultNow(),
  fechaPago: date('fecha_pago').notNull(),
  monto: numeric('monto', { precision: 14, scale: 2 }).notNull(),
  estado: text('estado')
    .$type<'en_cartera' | 'depositado' | 'entregado_proveedor' | 'rechazado' | 'anulado'>()
    .notNull()
    .default('en_cartera'),
  clienteId: uuid('cliente_id'),
  proveedorId: uuid('proveedor_id'),
  movimientoCajaId: uuid('movimiento_caja_id'),
  cuentaBancariaDestino: text('cuenta_bancaria_destino'),
  fechaDeposito: date('fecha_deposito'),
  fechaEntrega: date('fecha_entrega'),
  notas: text('notas'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const puntoVenta = pgTable('punto_venta', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  numero: integer('numero').notNull(),
  nombre: text('nombre').notNull().default('Punto de Venta Principal'),
  tipo: text('tipo').$type<'electronico_arca' | 'manual_contingencia'>().notNull().default('electronico_arca'),
  habilitado: boolean('habilitado').notNull().default(true),
  cuitEmisor: text('cuit_emisor'),
  inicioActividades: date('inicio_actividades'),
  iibb: text('iibb'),
  notas: text('notas'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const comprobanteFiscal = pgTable('comprobante_fiscal', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  puntoVentaId: uuid('punto_venta_id').notNull(),
  numeroPuntoVenta: integer('numero_punto_venta').notNull(),
  tipoComprobante: text('tipo_comprobante')
    .$type<
      | 'factura_a'
      | 'nota_credito_a'
      | 'nota_debito_a'
      | 'factura_b'
      | 'nota_credito_b'
      | 'nota_debito_b'
      | 'factura_c'
      | 'nota_credito_c'
      | 'nota_debito_c'
    >()
    .notNull(),
  codigoAfip: integer('codigo_afip').notNull(),
  numeroComprobante: integer('numero_comprobante').notNull(),
  fechaEmision: date('fecha_emision').notNull().defaultNow(),
  ventaId: uuid('venta_id'),
  clienteId: uuid('cliente_id'),
  cuitCliente: text('cuit_cliente'),
  tipoDocumentoAfip: integer('tipo_documento_afip').notNull().default(99),
  razonSocialCliente: text('razon_social_cliente').notNull(),
  condicionIvaCliente: text('condicion_iva_cliente').notNull().default('consumidor_final'),
  domicilioCliente: text('domicilio_cliente'),
  subtotalNetoGravado: numeric('subtotal_neto_gravado', { precision: 14, scale: 2 }).notNull().default('0.00'),
  subtotalIva21: numeric('subtotal_iva_21', { precision: 14, scale: 2 }).notNull().default('0.00'),
  subtotalIva105: numeric('subtotal_iva_105', { precision: 14, scale: 2 }).notNull().default('0.00'),
  subtotalIva27: numeric('subtotal_iva_27', { precision: 14, scale: 2 }).notNull().default('0.00'),
  subtotalExento: numeric('subtotal_exento', { precision: 14, scale: 2 }).notNull().default('0.00'),
  subtotalNoGravado: numeric('subtotal_no_gravado', { precision: 14, scale: 2 }).notNull().default('0.00'),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
  estado: text('estado')
    .$type<'autorizado' | 'contingencia_offline' | 'rechazado' | 'anulado'>()
    .notNull()
    .default('autorizado'),
  cae: text('cae'),
  vencimientoCae: date('vencimiento_cae'),
  codigoQrArca: text('codigo_qr_arca'),
  resultadoAfip: text('resultado_afip'),
  motivoObservacionAfip: text('motivo_observacion_afip'),
  creadoPor: uuid('creado_por').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});






export const itemComprobanteFiscal = pgTable('item_comprobante_fiscal', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  comprobanteId: uuid('comprobante_id').notNull(),
  productoId: uuid('producto_id'),
  codigo: text('codigo'),
  descripcion: text('descripcion').notNull(),
  unidad: text('unidad').notNull().default('unidad'),
  cantidad: numeric('cantidad', { precision: 14, scale: 3 }).notNull(),
  precioUnitario: numeric('precio_unitario', { precision: 14, scale: 2 }).notNull(),
  alicuotaIva: text('alicuota_iva').notNull().default('21'),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

// Fase 7: Contabilidad y Partida Doble
export const cuentaContable = pgTable('cuenta_contable', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  codigo: text('codigo').notNull(),
  nombre: text('nombre').notNull(),
  tipo: text('tipo')
    .$type<'activo' | 'pasivo' | 'patrimonio_neto' | 'ingreso' | 'egreso'>()
    .notNull(),
  descripcion: text('descripcion'),
  activa: boolean('activa').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const asientoContable = pgTable('asiento_contable', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  numero: integer('numero').notNull(),
  fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
  concepto: text('concepto').notNull(),
  origen: text('origen')
    .$type<
      | 'venta'
      | 'egreso_caja'
      | 'cobro_cta_cte'
      | 'compra_stock'
      | 'pago_proveedor'
      | 'deposito_cheque'
      | 'ajuste'
      | 'manual'
    >()
    .notNull(),
  referenciaId: uuid('referencia_id'),
  creadoPor: text('creado_por'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const renglonAsiento = pgTable('renglon_asiento', {
  id: uuid('id').primaryKey().defaultRandom(),
  asientoId: uuid('asiento_id').notNull(),
  negocioId: uuid('negocio_id').notNull(),
  cuentaId: uuid('cuenta_id').notNull(),
  debe: numeric('debe', { precision: 14, scale: 2 }).notNull().default('0.00'),
  haber: numeric('haber', { precision: 14, scale: 2 }).notNull().default('0.00'),
  descripcion: text('descripcion'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});


// Presupuestos y Cotizaciones de Mostrador
export const presupuesto = pgTable('presupuesto', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  numero: integer('numero').notNull(),
  fechaEmision: timestamp('fecha_emision', { withTimezone: true }).notNull().defaultNow(),
  fechaVencimiento: date('fecha_vencimiento').notNull(),
  diasValidez: integer('dias_validez').notNull().default(15),
  clienteId: uuid('cliente_id'),
  nombreContacto: text('nombre_contacto'),
  telefonoContacto: text('telefono_contacto'),
  emailContacto: text('email_contacto'),
  listaPrecioId: uuid('lista_precio_id'),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0.00'),
  descuentoGeneral: numeric('descuento_general', { precision: 14, scale: 2 }).notNull().default('0.00'),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
  estado: text('estado')
    .$type<'pendiente' | 'aprobado_convertido' | 'vencido' | 'cancelado'>()
    .notNull()
    .default('pendiente'),
  ventaId: uuid('venta_id'),
  observaciones: text('observaciones'),
  creadoPor: text('creado_por'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const itemPresupuesto = pgTable('item_presupuesto', {
  id: uuid('id').primaryKey().defaultRandom(),
  presupuestoId: uuid('presupuesto_id').notNull(),
  negocioId: uuid('negocio_id').notNull(),
  productoId: uuid('producto_id'),
  codigo: text('codigo'),
  nombre: text('nombre').notNull(),
  unidad: text('unidad').notNull().default('unidad'),
  cantidad: numeric('cantidad', { precision: 14, scale: 3 }).notNull(),
  precioUnitario: numeric('precio_unitario', { precision: 14, scale: 2 }).notNull(),
  descuentoPct: numeric('descuento_pct', { precision: 5, scale: 2 }).notNull().default('0.00'),
  subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
  notas: text('notas'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

// Control de Inventario Físico y Auditoría de Stock (Fase 16)
export const inventarioFisico = pgTable('inventario_fisico', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  numero: integer('numero').notNull(),
  nombre: text('nombre').notNull(),
  rubroId: uuid('rubro_id'),
  estado: text('estado')
    .$type<'en_proceso' | 'aplicado' | 'cancelado'>()
    .notNull()
    .default('en_proceso'),
  totalArticulos: integer('total_articulos').notNull().default(0),
  articulosConDiferencia: integer('articulos_con_diferencia').notNull().default(0),
  diferenciaNetaValorizada: numeric('diferencia_neta_valorizada', {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default('0.00'),
  observaciones: text('observaciones'),
  iniciadoPorUsuarioId: text('iniciado_por_usuario_id').notNull(),
  iniciadoPorNombre: text('iniciado_por_nombre').notNull(),
  aplicadoPorUsuarioId: text('aplicado_por_usuario_id'),
  aplicadoPorNombre: text('aplicado_por_nombre'),
  asientoId: uuid('asiento_id'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  aplicadoEn: timestamp('aplicado_en', { withTimezone: true }),
});

export const itemInventarioFisico = pgTable('item_inventario_fisico', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  inventarioId: uuid('inventario_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  stockSistema: numeric('stock_sistema', { precision: 14, scale: 3 }).notNull(),
  stockContado: numeric('stock_contado', { precision: 14, scale: 3 }),
  diferencia: numeric('diferencia', { precision: 14, scale: 3 })
    .notNull()
    .default('0.000'),
  costoUnitario: numeric('costo_unitario', { precision: 14, scale: 2 })
    .notNull()
    .default('0.00'),
  diferenciaValorizada: numeric('diferencia_valorizada', {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default('0.00'),
  contadoEn: timestamp('contado_en', { withTimezone: true }),
  contadoPorNombre: text('contado_por_nombre'),
});

// Listas de Precios Múltiples y Reglas de Descuento por Volumen (Fase 17A)
export const reglaDescuentoVolumen = pgTable('regla_descuento_volumen', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  productoId: uuid('producto_id'),
  rubroId: uuid('rubro_id'),
  listaPrecioId: uuid('lista_precio_id'),
  cantidadMinima: numeric('cantidad_minima', { precision: 14, scale: 3 }).notNull(),
  descuentoPct: numeric('descuento_pct', { precision: 5, scale: 2 }).notNull(),
  activo: boolean('activo').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const precioProductoLista = pgTable('precio_producto_lista', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  listaPrecioId: uuid('lista_precio_id').notNull(),
  precioFijo: numeric('precio_fijo', { precision: 14, scale: 2 }).notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});
