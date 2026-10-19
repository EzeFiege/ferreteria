-- 006_tesoreria_flujo.sql
-- Fase 5: Cartera de cheques / eCheqs, acreditaciones diferidas y flujo de fondos proyectado

-- 1. Cartera de cheques recibidos y emitidos / eCheqs
create table if not exists cheque_cartera (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  tipo text not null default 'fisico' check (tipo in ('fisico', 'echeq')),
  numero text not null,
  banco text not null,
  cuit_emisor text,
  titular text,
  fecha_emision date not null default current_date,
  fecha_pago date not null,
  monto numeric(14,2) not null check (monto > 0),
  estado text not null default 'en_cartera' check (estado in ('en_cartera', 'depositado', 'entregado_proveedor', 'rechazado', 'anulado')),
  cliente_id uuid references cliente(id) on delete set null,
  proveedor_id uuid references proveedor(id) on delete set null,
  movimiento_caja_id uuid references movimiento(id) on delete set null,
  cuenta_bancaria_destino text,
  fecha_deposito date,
  fecha_entrega date,
  notas text,
  creado_por uuid not null references usuario(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (id, negocio_id)
);

create index if not exists idx_cheque_cartera_negocio_estado on cheque_cartera(negocio_id, estado);
create index if not exists idx_cheque_cartera_fecha_pago on cheque_cartera(negocio_id, fecha_pago);

-- RLS para cheque_cartera
alter table cheque_cartera enable row level security;

drop policy if exists cheque_cartera_tenant_isolation on cheque_cartera;
create policy cheque_cartera_tenant_isolation on cheque_cartera
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update on cheque_cartera to app_user;

-- 2. Vista de Flujo de Caja Proyectado
-- Consolida:
-- - Cheques en cartera por cobrar según su fecha_pago
-- - Ventas realizadas con medios electrónicos (tarjeta/QR) pendientes de acreditación (creado_en + dias_acreditacion)
-- - Deuda con proveedores a pagar según dias_plazo_pago
create or replace view v_flujo_caja_proyectado as
with cobros_tarjetas as (
  select
    m.negocio_id,
    (m.creado_en::date + (coalesce(mp.dias_acreditacion, 0) || ' days')::interval)::date as fecha,
    'acreditacion_tarjeta' as tipo,
    'Acreditación estimada ' || mp.nombre as descripcion,
    'ingreso' as sentido,
    sum(m.monto) as monto
  from movimiento m
  join medio_pago mp on mp.id = m.medio_pago_id
  where m.tipo = 'venta'
    and m.sentido = 'in'
    and coalesce(mp.es_efectivo, false) = false
    and coalesce(mp.dias_acreditacion, 0) > 0
    and (m.creado_en::date + (coalesce(mp.dias_acreditacion, 0) || ' days')::interval)::date >= current_date
  group by m.negocio_id, (m.creado_en::date + (coalesce(mp.dias_acreditacion, 0) || ' days')::interval)::date, mp.nombre
),
cheques_cobro as (
  select
    ch.negocio_id,
    ch.fecha_pago as fecha,
    'cheque_en_cartera' as tipo,
    'Cheque ' || ch.banco || ' Nº ' || ch.numero as descripcion,
    'ingreso' as sentido,
    sum(ch.monto) as monto
  from cheque_cartera ch
  where ch.estado = 'en_cartera'
    and ch.fecha_pago >= current_date
  group by ch.negocio_id, ch.fecha_pago, ch.banco, ch.numero
),
pagos_proveedores_estimados as (
  select
    oc.negocio_id,
    (oc.creado_en::date + (coalesce(p.dias_plazo_pago, 30) || ' days')::interval)::date as fecha,
    'vencimiento_proveedor' as tipo,
    'Vencimiento compra ' || p.razon_social || ' (' || oc.numero || ')' as descripcion,
    'egreso' as sentido,
    sum(oc.total) as monto
  from orden_compra oc
  join proveedor p on p.id = oc.proveedor_id
  where oc.estado = 'recibida'
    and oc.condicion_pago = 'cuenta_corriente'
    and (oc.creado_en::date + (coalesce(p.dias_plazo_pago, 30) || ' days')::interval)::date >= current_date
  group by oc.negocio_id, (oc.creado_en::date + (coalesce(p.dias_plazo_pago, 30) || ' days')::interval)::date, p.razon_social, oc.numero
)
select * from cobros_tarjetas
union all
select * from cheques_cobro
union all
select * from pagos_proveedores_estimados
order by fecha asc;

grant select on v_flujo_caja_proyectado to app_user;
