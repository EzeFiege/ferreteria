-- 018_acopio_materiales.sql
-- Fase 18: Acopio de Materiales y Entregas Parciales (Venta Acopiada)

begin;

-- 1. Ampliar tipos permitidos en Kardex inmutable para registrar entregas físicas de acopio
alter table movimiento_stock drop constraint if exists movimiento_stock_tipo_check;
alter table movimiento_stock add constraint movimiento_stock_tipo_check
  check (tipo in ('ingreso_compra','egreso_venta','ajuste_sobrante','ajuste_faltante','merma_rotura','devolucion','entrega_acopio'));

-- 2. Tabla principal de Acopios
create table if not exists acopio (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references negocio(id),
  numero         varchar(30) not null,
  cliente_id     uuid not null,
  venta_id       uuid,
  estado         text not null check (estado in ('activo', 'completado', 'cancelado')) default 'activo',
  fecha_emision  date not null default current_date,
  notas          text,
  creado_por     text not null,
  creado_en      timestamptz not null default now(),
  unique (negocio_id, numero),
  unique (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente(id, negocio_id),
  foreign key (venta_id, negocio_id) references venta(id, negocio_id)
);

-- 3. Renglones / Ítems del Acopio
create table if not exists item_acopio (
  id                  uuid primary key default gen_random_uuid(),
  negocio_id          uuid not null references negocio(id),
  acopio_id           uuid not null,
  producto_id         uuid not null,
  cantidad_comprada   numeric(14,3) not null check (cantidad_comprada > 0),
  cantidad_entregada  numeric(14,3) not null default 0 check (cantidad_entregada >= 0),
  precio_unitario     numeric(14,2) not null check (precio_unitario >= 0),
  subtotal            numeric(14,2) not null check (subtotal >= 0),
  unique (id, negocio_id),
  foreign key (acopio_id, negocio_id) references acopio(id, negocio_id) on delete cascade,
  foreign key (producto_id, negocio_id) references producto(id, negocio_id)
);

-- 4. Remitos de Entrega Parcial o Total
create table if not exists remito_entrega_acopio (
  id                   uuid primary key default gen_random_uuid(),
  negocio_id           uuid not null references negocio(id),
  acopio_id            uuid not null,
  numero               varchar(30) not null,
  fecha                timestamptz not null default now(),
  retirado_por_nombre  text not null,
  retirado_por_dni     text,
  vehiculo_patente     text,
  observaciones        text,
  creado_por           text not null,
  unique (negocio_id, numero),
  unique (id, negocio_id),
  foreign key (acopio_id, negocio_id) references acopio(id, negocio_id) on delete cascade
);

-- 5. Renglones del Remito de Entrega
create table if not exists item_remito_entrega_acopio (
  id                  uuid primary key default gen_random_uuid(),
  negocio_id          uuid not null references negocio(id),
  remito_id           uuid not null,
  item_acopio_id      uuid not null,
  producto_id         uuid not null,
  cantidad            numeric(14,3) not null check (cantidad > 0),
  unique (id, negocio_id),
  foreign key (remito_id, negocio_id) references remito_entrega_acopio(id, negocio_id) on delete cascade,
  foreign key (item_acopio_id, negocio_id) references item_acopio(id, negocio_id),
  foreign key (producto_id, negocio_id) references producto(id, negocio_id)
);

-- 6. Índices de rendimiento
create index if not exists idx_acopio_negocio_estado on acopio(negocio_id, estado);
create index if not exists idx_acopio_negocio_cliente on acopio(negocio_id, cliente_id);
create index if not exists idx_item_acopio_negocio_acopio on item_acopio(negocio_id, acopio_id);
create index if not exists idx_item_acopio_producto on item_acopio(negocio_id, producto_id);
create index if not exists idx_remito_acopio_negocio on remito_entrega_acopio(negocio_id, acopio_id);
create index if not exists idx_item_remito_acopio on item_remito_entrega_acopio(negocio_id, remito_id);

-- 7. Vista analítica de resumen de acopios
create or replace view v_acopios_resumen with (security_invoker = true) as
select
  a.id,
  a.negocio_id,
  a.numero,
  a.estado,
  a.fecha_emision,
  a.cliente_id,
  c.nombre as cliente_nombre,
  c.cuit_dni as cliente_cuit_dni,
  c.telefono as cliente_telefono,
  a.venta_id,
  a.notas,
  a.creado_por,
  a.creado_en,
  count(ia.id)::int as total_articulos,
  coalesce(sum(ia.cantidad_comprada), 0) as total_unidades_compradas,
  coalesce(sum(ia.cantidad_entregada), 0) as total_unidades_entregadas,
  coalesce(sum(ia.cantidad_comprada - ia.cantidad_entregada), 0) as saldo_unidades_pendientes,
  coalesce(sum(ia.subtotal), 0) as total_valorizado,
  case
    when sum(ia.cantidad_comprada) > 0 then
      round((sum(ia.cantidad_entregada) / sum(ia.cantidad_comprada)) * 100, 1)
    else 0
  end as pct_entregado
from acopio a
join cliente c on c.id = a.cliente_id and c.negocio_id = a.negocio_id
left join item_acopio ia on ia.acopio_id = a.id and ia.negocio_id = a.negocio_id
group by a.id, a.negocio_id, a.numero, a.estado, a.fecha_emision, a.cliente_id, c.nombre, c.cuit_dni, c.telefono, a.venta_id, a.notas, a.creado_por, a.creado_en;

-- 8. Seguridad por fila (RLS)
alter table acopio enable row level security;
alter table acopio force row level security;
drop policy if exists acopio_tenant_isolation on acopio;
create policy acopio_tenant_isolation on acopio
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

alter table item_acopio enable row level security;
alter table item_acopio force row level security;
drop policy if exists item_acopio_tenant_isolation on item_acopio;
create policy item_acopio_tenant_isolation on item_acopio
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

alter table remito_entrega_acopio enable row level security;
alter table remito_entrega_acopio force row level security;
drop policy if exists remito_entrega_acopio_tenant_isolation on remito_entrega_acopio;
create policy remito_entrega_acopio_tenant_isolation on remito_entrega_acopio
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

alter table item_remito_entrega_acopio enable row level security;
alter table item_remito_entrega_acopio force row level security;
drop policy if exists item_remito_entrega_acopio_tenant_isolation on item_remito_entrega_acopio;
create policy item_remito_entrega_acopio_tenant_isolation on item_remito_entrega_acopio
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

-- 9. Privilegios para app_user
grant select, insert, update on acopio to app_user;
grant select, insert, update on item_acopio to app_user;
grant select, insert, update on remito_entrega_acopio to app_user;
grant select, insert, update on item_remito_entrega_acopio to app_user;
grant select on v_acopios_resumen to app_user;

commit;
