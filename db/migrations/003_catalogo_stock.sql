-- 003_catalogo_stock.sql
-- Fase 2: Catálogo de artículos, fraccionamiento, listas de precios y stock vivo (kardex inmutable).
-- Requiere PostgreSQL 15+. Principios de AGENTS.md:
--   * movimiento_stock es libro de solo agregar (inmutable).
--   * el stock actual se calcula (v_stock_actual), nunca se tipea ni se persiste.
--   * dinero en numeric(14,2); cantidades en numeric(14,3).
--   * todo con negocio_id y RLS activo para app_user.

begin;

-- ---------------------------------------------------------------- listas de precios
create table lista_precio (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocio(id),
  nombre     text not null,
  margen_pct numeric(5,2) not null default 0 check (margen_pct >= 0),
  activo     boolean not null default true,
  orden      integer not null default 1,
  creado_en  timestamptz not null default now(),
  unique (negocio_id, nombre),
  unique (id, negocio_id)
);

-- ---------------------------------------------------------------- catálogo de productos
create table producto (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references negocio(id),
  rubro_id           uuid,
  codigo             text not null,                 -- SKU / Código interno del negocio
  nombre             text not null,
  marca              text,
  descripcion        text,
  imagen_url         text,
  codigo_qr          text,                          -- Para lectura 2D o etiquetas en estantería
  costo_base         numeric(14,2) not null default 0 check (costo_base >= 0),
  unidad_principal   text not null default 'un',    -- Ej: 'rollo', 'caja', 'bolsa', 'un'
  unidad_secundaria  text,                          -- Ej: 'metro', 'kg', 'un' (para fraccionables)
  factor_conversion  numeric(14,3) not null default 1 check (factor_conversion > 0), -- Cuántas unidades secundarias forman 1 principal
  permite_fraccion   boolean not null default false,
  stock_minimo       numeric(14,3) not null default 0,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  unique (negocio_id, codigo),
  unique (id, negocio_id),
  foreign key (rubro_id, negocio_id) references rubro(id, negocio_id)
);

-- ---------------------------------------------------------------- códigos de barra
create table producto_codigo_barra (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references negocio(id),
  producto_id  uuid not null,
  codigo_barra text not null,                       -- EAN-13, UPC o código de barras interno
  es_principal boolean not null default true,
  creado_en    timestamptz not null default now(),
  unique (negocio_id, codigo_barra),
  unique (id, negocio_id),
  foreign key (producto_id, negocio_id) references producto(id, negocio_id)
);

-- ---------------------------------------------------------------- kardex de stock (solo agregar)
create table movimiento_stock (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references negocio(id),
  producto_id     uuid not null,
  turno_id        uuid,
  venta_id        uuid,
  tipo            text not null check (tipo in ('ingreso_compra','egreso_venta','ajuste_sobrante','ajuste_faltante','merma_rotura','devolucion')),
  sentido         text not null check (sentido in ('in','out')),
  cantidad        numeric(14,3) not null check (cantidad > 0),
  unidad          text not null,                    -- En qué unidad se realizó la operación (principal o secundaria)
  cantidad_base   numeric(14,3) not null check (cantidad_base > 0), -- Cantidad convertida a la unidad_principal
  costo_unitario  numeric(14,2) not null default 0 check (costo_unitario >= 0),
  notas           text,
  revierte_id     uuid,
  creado_por      uuid not null,
  creado_en       timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (producto_id, negocio_id) references producto(id, negocio_id),
  foreign key (revierte_id, negocio_id) references movimiento_stock(id, negocio_id)
);

-- Trigger de inmutabilidad: prohíbe terminantemente UPDATE y DELETE en movimiento_stock
create or replace function tg_movimiento_stock_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'movimiento_stock es de solo agregar; use un movimiento inverso para anular o corregir';
end $$;

create trigger trg_movimiento_stock_inmutable
  before update or delete on movimiento_stock
  for each row execute function tg_movimiento_stock_inmutable();

-- ---------------------------------------------------------------- vistas calculadas
-- Stock actual calculado en tiempo real (regla: nunca se guarda una columna estática de stock)
create view v_stock_actual with (security_invoker = true) as
select
  p.id as producto_id,
  p.negocio_id,
  p.codigo,
  p.nombre,
  p.marca,
  p.rubro_id,
  p.costo_base,
  p.unidad_principal,
  p.unidad_secundaria,
  p.factor_conversion,
  p.permite_fraccion,
  p.stock_minimo,
  coalesce(sum(case ms.sentido when 'in' then ms.cantidad_base else -ms.cantidad_base end), 0) as stock_actual_base
from producto p
left join movimiento_stock ms on ms.producto_id = p.id and ms.negocio_id = p.negocio_id
where p.activo = true
group by p.id, p.negocio_id;

-- Precios dinámicos calculados a partir de costo_base y listas de precios configuradas
create view v_precios_producto with (security_invoker = true) as
select
  p.id as producto_id,
  p.negocio_id,
  lp.id as lista_precio_id,
  lp.nombre as lista_nombre,
  lp.margen_pct,
  round(p.costo_base * (1 + lp.margen_pct / 100), 2) as precio_venta_principal,
  round((p.costo_base * (1 + lp.margen_pct / 100)) / p.factor_conversion, 2) as precio_venta_secundaria
from producto p
cross join lista_precio lp
where lp.negocio_id = p.negocio_id and lp.activo = true and p.activo = true;

-- ---------------------------------------------------------------- actualizar sembrar_negocio
create or replace function sembrar_negocio(p_negocio uuid) returns void language sql as $$
  insert into medio_pago (negocio_id, nombre, es_efectivo, dias_acreditacion) values
    (p_negocio, 'Efectivo',         true,  0),
    (p_negocio, 'Tarjeta',          false, 0),
    (p_negocio, 'Transferencia/QR', false, 0)
  on conflict (negocio_id, nombre) do nothing;

  insert into categoria (negocio_id, nombre, tipo) values
    (p_negocio, 'Proveedores',   'egreso'),
    (p_negocio, 'Sueldos',       'egreso'),
    (p_negocio, 'Servicios',     'egreso'),
    (p_negocio, 'Impuestos',     'egreso'),
    (p_negocio, 'Varios',        'egreso'),
    (p_negocio, 'Otros ingresos','ingreso')
  on conflict do nothing;

  insert into lista_precio (negocio_id, nombre, margen_pct, orden) values
    (p_negocio, 'Mostrador', 60.00, 1),
    (p_negocio, 'Gremio',    40.00, 2),
    (p_negocio, 'Mayorista', 25.00, 3)
  on conflict (negocio_id, nombre) do nothing;
$$;

-- ---------------------------------------------------------------- RLS y permisos
do $$
declare t text;
begin
  foreach t in array array['lista_precio', 'producto', 'producto_codigo_barra', 'movimiento_stock']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aislamiento_negocio on %I using (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)
         with check (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)', t);
  end loop;
end $$;

grant select, insert, update, delete on lista_precio, producto, producto_codigo_barra to app_user;
grant select, insert on movimiento_stock to app_user;
grant select on v_stock_actual, v_precios_producto to app_user;

commit;
