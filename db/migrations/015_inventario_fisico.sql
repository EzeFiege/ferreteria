-- 015_inventario_fisico.sql
-- Fase 16: Control de Inventario Físico, Recuentos Ciegos y Conciliación en Kardex

begin;

-- 1. Tabla de Toma de Inventario Físico
create table if not exists inventario_fisico (
  id                          uuid primary key default gen_random_uuid(),
  negocio_id                  uuid not null references negocio(id),
  numero                      integer not null,
  nombre                      text not null,
  rubro_id                    uuid,
  estado                      text not null check (estado in ('en_proceso', 'aplicado', 'cancelado')) default 'en_proceso',
  total_articulos             integer not null default 0,
  articulos_con_diferencia    integer not null default 0,
  diferencia_neta_valorizada  numeric(14,2) not null default 0,
  observaciones               text,
  iniciado_por_usuario_id     text not null,
  iniciado_por_nombre         text not null,
  aplicado_por_usuario_id     text,
  aplicado_por_nombre         text,
  asiento_id                  uuid,
  creado_en                   timestamptz not null default now(),
  aplicado_en                 timestamptz,
  unique (negocio_id, numero),
  unique (id, negocio_id),
  foreign key (rubro_id, negocio_id) references rubro(id, negocio_id)
);

-- 2. Renglones / Ítems del Inventario Físico
create table if not exists item_inventario_fisico (
  id                    uuid primary key default gen_random_uuid(),
  negocio_id            uuid not null references negocio(id),
  inventario_id         uuid not null,
  producto_id           uuid not null,
  stock_sistema         numeric(14,3) not null,
  stock_contado         numeric(14,3),
  diferencia            numeric(14,3) not null default 0,
  costo_unitario        numeric(14,2) not null default 0,
  diferencia_valorizada numeric(14,2) not null default 0,
  contado_en            timestamptz,
  contado_por_nombre    text,
  unique (inventario_id, producto_id),
  unique (id, negocio_id),
  foreign key (inventario_id, negocio_id) references inventario_fisico(id, negocio_id) on delete cascade,
  foreign key (producto_id, negocio_id) references producto(id, negocio_id)
);

-- 3. Índices
create index if not exists idx_inventario_fisico_negocio_estado on inventario_fisico(negocio_id, estado);
create index if not exists idx_item_inventario_fisico_negocio on item_inventario_fisico(negocio_id, inventario_id);
create index if not exists idx_item_inventario_fisico_producto on item_inventario_fisico(negocio_id, producto_id);

-- 4. Seguridad por fila (RLS)
alter table inventario_fisico enable row level security;
alter table inventario_fisico force row level security;

drop policy if exists inventario_fisico_tenant_isolation on inventario_fisico;
create policy inventario_fisico_tenant_isolation on inventario_fisico
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

alter table item_inventario_fisico enable row level security;
alter table item_inventario_fisico force row level security;

drop policy if exists item_inventario_fisico_tenant_isolation on item_inventario_fisico;
create policy item_inventario_fisico_tenant_isolation on item_inventario_fisico
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

-- 5. Privilegios para app_user
grant select, insert, update on inventario_fisico to app_user;
grant select, insert, update on item_inventario_fisico to app_user;

commit;
