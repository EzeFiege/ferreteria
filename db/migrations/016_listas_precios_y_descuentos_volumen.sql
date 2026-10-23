-- 016_listas_precios_y_descuentos_volumen.sql
-- Fase 17A: Listas de Precios Múltiples, Precios Fijos por Lista y Reglas de Descuento por Volumen

begin;

-- 1. Tabla de Reglas de Descuento por Volumen / Cantidad
create table if not exists regla_descuento_volumen (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references negocio(id),
  nombre          text not null,
  producto_id     uuid,
  rubro_id        uuid,
  lista_precio_id uuid,
  cantidad_minima numeric(14,3) not null check (cantidad_minima > 0),
  descuento_pct   numeric(5,2) not null check (descuento_pct >= 0 and descuento_pct <= 100),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (producto_id, negocio_id) references producto(id, negocio_id) on delete cascade,
  foreign key (rubro_id, negocio_id) references rubro(id, negocio_id) on delete cascade,
  foreign key (lista_precio_id, negocio_id) references lista_precio(id, negocio_id) on delete cascade,
  check (producto_id is not null or rubro_id is not null)
);

-- 2. Tabla de Precios Fijos por Producto en Lista Específica
create table if not exists precio_producto_lista (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references negocio(id),
  producto_id     uuid not null,
  lista_precio_id uuid not null,
  precio_fijo     numeric(14,2) not null check (precio_fijo >= 0),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (negocio_id, producto_id, lista_precio_id),
  unique (id, negocio_id),
  foreign key (producto_id, negocio_id) references producto(id, negocio_id) on delete cascade,
  foreign key (lista_precio_id, negocio_id) references lista_precio(id, negocio_id) on delete cascade
);

-- 3. Índices de rendimiento
create index if not exists idx_regla_volumen_negocio_prod on regla_descuento_volumen(negocio_id, producto_id) where activo = true;
create index if not exists idx_regla_volumen_negocio_rubro on regla_descuento_volumen(negocio_id, rubro_id) where activo = true;
create index if not exists idx_precio_producto_lista_negocio on precio_producto_lista(negocio_id, lista_precio_id, producto_id);

-- 4. Seguridad por fila (RLS)
alter table regla_descuento_volumen enable row level security;
alter table regla_descuento_volumen force row level security;

drop policy if exists regla_volumen_tenant_isolation on regla_descuento_volumen;
create policy regla_volumen_tenant_isolation on regla_descuento_volumen
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

alter table precio_producto_lista enable row level security;
alter table precio_producto_lista force row level security;

drop policy if exists precio_prod_lista_tenant_isolation on precio_producto_lista;
create policy precio_prod_lista_tenant_isolation on precio_producto_lista
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

-- 5. Actualizar vista v_precios_producto para respetar precios fijos manuales
drop view if exists v_precios_producto;
create view v_precios_producto with (security_invoker = true) as
select
  p.id as producto_id,
  p.negocio_id,
  lp.id as lista_precio_id,
  lp.nombre as lista_nombre,
  lp.margen_pct,
  coalesce(ppl.precio_fijo, round(p.costo_base * (1 + lp.margen_pct / 100), 2)) as precio_venta_principal,
  round(coalesce(ppl.precio_fijo, round(p.costo_base * (1 + lp.margen_pct / 100), 2)) / p.factor_conversion, 2) as precio_venta_secundaria,
  case when ppl.precio_fijo is not null then true else false end as es_precio_fijo
from producto p
cross join lista_precio lp
left join precio_producto_lista ppl
  on ppl.producto_id = p.id
 and ppl.lista_precio_id = lp.id
 and ppl.negocio_id = p.negocio_id
where lp.negocio_id = p.negocio_id and lp.activo = true and p.activo = true;

-- 6. Concesión de privilegios para app_user
grant select, insert, update, delete on regla_descuento_volumen to app_user;
grant select, insert, update, delete on precio_producto_lista to app_user;
grant select on v_precios_producto to app_user;

commit;
