-- ============================================================================
-- Migración 020: Múltiples Depósitos y Transferencias Internas de Stock
-- ============================================================================

begin;

-- 1. Tabla de depósitos y sucursales físicas de almacenamiento
create table if not exists deposito (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references negocio(id),
  nombre       text not null,
  codigo       text not null,
  direccion    text,
  es_principal boolean not null default false,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  unique (negocio_id, codigo),
  unique (id, negocio_id)
);

-- Habilitar RLS en deposito
alter table deposito enable row level security;
drop policy if exists rls_deposito on deposito;
create policy rls_deposito on deposito
  for all to app_user
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

-- 2. Vincular movimiento_stock a un depósito específico
alter table movimiento_stock
  add column if not exists deposito_id uuid;

alter table movimiento_stock
  drop constraint if exists movimiento_stock_tipo_check;

alter table movimiento_stock
  add constraint movimiento_stock_tipo_check
  check (tipo in (
    'ingreso_compra',
    'egreso_venta',
    'ajuste_sobrante',
    'ajuste_faltante',
    'merma_rotura',
    'devolucion',
    'entrega_acopio',
    'transferencia_origen',
    'transferencia_destino'
  ));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_movimiento_stock_deposito'
  ) then
    alter table movimiento_stock
      add constraint fk_movimiento_stock_deposito
      foreign key (deposito_id, negocio_id) references deposito(id, negocio_id);
  end if;
end $$;

-- 3. Crear depósito principal predeterminado para cada negocio existente
insert into deposito (negocio_id, nombre, codigo, es_principal)
select id, 'Local Principal', 'DEP-01', true
from negocio
on conflict (negocio_id, codigo) do nothing;

-- Asignar los movimientos de stock existentes sin depósito al depósito principal del negocio
update movimiento_stock ms
set deposito_id = d.id
from deposito d
where ms.deposito_id is null
  and d.negocio_id = ms.negocio_id
  and d.es_principal = true;

-- 4. Cabecera de Transferencia de Stock entre Depósitos
create table if not exists transferencia_stock (
  id                   uuid primary key default gen_random_uuid(),
  negocio_id           uuid not null references negocio(id),
  numero               text not null,
  deposito_origen_id   uuid not null,
  deposito_destino_id  uuid not null,
  estado               text not null default 'completada' check (estado in ('pendiente', 'en_transito', 'completada', 'cancelada')),
  motivo               text,
  observaciones        text,
  creado_por           uuid not null,
  recibido_por         uuid,
  creado_en            timestamptz not null default now(),
  completado_en        timestamptz default now(),
  unique (negocio_id, numero),
  unique (id, negocio_id),
  foreign key (deposito_origen_id, negocio_id) references deposito(id, negocio_id),
  foreign key (deposito_destino_id, negocio_id) references deposito(id, negocio_id),
  check (deposito_origen_id <> deposito_destino_id)
);

alter table transferencia_stock enable row level security;
drop policy if exists rls_transferencia_stock on transferencia_stock;
create policy rls_transferencia_stock on transferencia_stock
  for all to app_user
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

-- 5. Detalle de Ítems de la Transferencia de Stock
create table if not exists item_transferencia_stock (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references negocio(id),
  transferencia_id   uuid not null,
  producto_id        uuid not null,
  cantidad           numeric(14,3) not null check (cantidad > 0),
  unidad             text not null,
  cantidad_base      numeric(14,3) not null check (cantidad_base > 0),
  notas              text,
  unique (id, negocio_id),
  foreign key (transferencia_id, negocio_id) references transferencia_stock(id, negocio_id) on delete cascade,
  foreign key (producto_id, negocio_id) references producto(id, negocio_id)
);

alter table item_transferencia_stock enable row level security;
drop policy if exists rls_item_transferencia_stock on item_transferencia_stock;
create policy rls_item_transferencia_stock on item_transferencia_stock
  for all to app_user
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

-- 6. Vista de Stock por Depósito y Producto
create or replace view v_stock_por_deposito with (security_invoker = true) as
select
  p.id as producto_id,
  p.negocio_id,
  p.codigo as producto_codigo,
  p.nombre as producto_nombre,
  p.marca as producto_marca,
  p.unidad_principal,
  d.id as deposito_id,
  d.codigo as deposito_codigo,
  d.nombre as deposito_nombre,
  coalesce(sum(case ms.sentido when 'in' then ms.cantidad_base else -ms.cantidad_base end), 0) as stock_actual_base
from producto p
cross join deposito d
left join movimiento_stock ms on ms.producto_id = p.id
                              and ms.negocio_id = p.negocio_id
                              and ms.deposito_id = d.id
where p.activo = true
  and d.activo = true
  and d.negocio_id = p.negocio_id
group by p.id, p.negocio_id, p.codigo, p.nombre, p.marca, p.unidad_principal, d.id, d.codigo, d.nombre;

-- 7. Actualizar función sembrar_negocio para crear siempre el depósito principal inicial
create or replace function sembrar_negocio(p_negocio uuid) returns void language plpgsql as $$
begin
  insert into medio_pago (negocio_id, nombre, es_efectivo, dias_acreditacion) values
    (p_negocio, 'Efectivo',         true,  0),
    (p_negocio, 'Tarjeta',          false, 0),
    (p_negocio, 'Transferencia/QR', false, 0),
    (p_negocio, 'Cuenta Corriente', false, 30)
  on conflict (negocio_id, nombre) do nothing;

  insert into categoria (negocio_id, nombre, tipo) values
    (p_negocio, 'Proveedores',   'egreso'),
    (p_negocio, 'Sueldos',       'egreso'),
    (p_negocio, 'Servicios',     'egreso'),
    (p_negocio, 'Impuestos',     'egreso'),
    (p_negocio, 'Varios',        'egreso'),
    (p_negocio, 'Cobranza cta cte', 'ingreso'),
    (p_negocio, 'Otros ingresos','ingreso')
  on conflict (negocio_id, nombre, tipo) do nothing;

  insert into lista_precio (negocio_id, nombre, margen_pct, orden) values
    (p_negocio, 'Mostrador', 60.00, 1),
    (p_negocio, 'Gremio',    40.00, 2),
    (p_negocio, 'Mayorista', 25.00, 3)
  on conflict (negocio_id, nombre) do nothing;

  insert into deposito (negocio_id, nombre, codigo, es_principal) values
    (p_negocio, 'Local Principal', 'DEP-01', true),
    (p_negocio, 'Depósito Central', 'DEP-02', false),
    (p_negocio, 'Patio de Corralón', 'DEP-03', false)
  on conflict (negocio_id, codigo) do nothing;
end;
$$;

-- 8. Permisos a app_user
grant select, insert, update on deposito, transferencia_stock, item_transferencia_stock to app_user;
grant select on v_stock_por_deposito to app_user;

commit;
