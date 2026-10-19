-- 005_compras_proveedores.sql
-- Fase 4: Compras, gestión de proveedores, recepción de mercadería y cuentas a pagar.
-- Principios innegociables de AGENTS.md:
--   * movimiento_cta_cte_proveedor es un libro de solo agregar (inmutable).
--   * la recepción de mercadería ingresa al kardex inmutable movimiento_stock ('ingreso_compra').
--   * los saldos no se guardan ni se tipean: se calculan en v_saldo_proveedor.
--   * dinero en numeric(14,2) y cantidades en numeric(14,3).
--   * multi-negocio con claves foráneas compuestas (id, negocio_id) y RLS activo para app_user.

begin;

-- ---------------------------------------------------------------- proveedores
create table proveedor (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references negocio(id),
  codigo           text not null,                             -- Ej: PRV-001
  razon_social     text not null,                             -- Nombre legal o comercial
  nombre_fantasia  text,
  cuit             text,
  condicion_iva    text not null default 'responsable_inscripto' check (condicion_iva in ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final')),
  telefono         text,
  email            text,
  direccion        text,
  contacto_nombre  text,                                      -- Vendedor o persona de contacto
  dias_plazo_pago  integer not null default 30 check (dias_plazo_pago >= 0),
  activo           boolean not null default true,
  notas            text,
  creado_en        timestamptz not null default now(),
  unique (id, negocio_id),
  unique (negocio_id, codigo)
);

-- ---------------------------------------------------------------- catálogo del proveedor
create table producto_proveedor (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references negocio(id),
  producto_id      uuid not null,
  proveedor_id     uuid not null,
  codigo_proveedor text,                                      -- Código del catálogo del fabricante/distribuidor
  costo_proveedor  numeric(14,2) not null check (costo_proveedor >= 0),
  es_principal     boolean not null default false,
  actualizado_en   timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (producto_id, negocio_id) references producto(id, negocio_id) on delete cascade,
  foreign key (proveedor_id, negocio_id) references proveedor(id, negocio_id) on delete cascade
);

-- ---------------------------------------------------------------- órdenes de compra / facturas proveedor
create table orden_compra (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references negocio(id),
  numero           text not null,                             -- Ej: OC-0001 o N° factura/remito proveedor
  proveedor_id     uuid not null,
  estado           text not null default 'borrador' check (estado in ('borrador', 'confirmada', 'recibida', 'anulada')),
  condicion_pago   text not null default 'cuenta_corriente' check (condicion_pago in ('contado', 'cuenta_corriente')),
  fecha_emision    date not null default current_date,
  fecha_esperada   date,
  fecha_recepcion  timestamptz,
  total            numeric(14,2) not null default 0 check (total >= 0),
  notas            text,
  creado_por       uuid not null references usuario(id),
  recibido_por     uuid references usuario(id),
  creado_en        timestamptz not null default now(),
  unique (id, negocio_id),
  unique (negocio_id, numero),
  foreign key (proveedor_id, negocio_id) references proveedor(id, negocio_id)
);

-- ---------------------------------------------------------------- ítems de orden de compra
create table item_orden_compra (
  id                uuid primary key default gen_random_uuid(),
  negocio_id        uuid not null references negocio(id),
  orden_compra_id   uuid not null,
  producto_id       uuid not null,
  descripcion       text not null,
  cantidad_pedida   numeric(14,3) not null check (cantidad_pedida > 0),
  cantidad_recibida numeric(14,3) not null default 0 check (cantidad_recibida >= 0),
  costo_unitario    numeric(14,2) not null check (costo_unitario >= 0),
  subtotal          numeric(14,2) not null check (subtotal >= 0),
  unique (id, negocio_id),
  foreign key (orden_compra_id, negocio_id) references orden_compra(id, negocio_id) on delete cascade,
  foreign key (producto_id, negocio_id) references producto(id, negocio_id)
);

-- ---------------------------------------------------------------- cuenta corriente de proveedores (inmutable)
create table movimiento_cta_cte_proveedor (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references negocio(id),
  proveedor_id       uuid not null,
  tipo               text not null check (tipo in ('debito_compra', 'credito_pago', 'ajuste_debito', 'ajuste_credito')),
  sentido            text not null check (sentido in ('debito', 'credito')),
  monto              numeric(14,2) not null check (monto > 0),
  orden_compra_id    uuid,
  movimiento_caja_id uuid,                                    -- Imputación al egreso del turno de caja si se pagó en mostrador
  descripcion        text,
  revierte_id        uuid,
  creado_por         uuid not null references usuario(id),
  creado_en          timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (proveedor_id, negocio_id) references proveedor(id, negocio_id),
  foreign key (orden_compra_id, negocio_id) references orden_compra(id, negocio_id),
  foreign key (movimiento_caja_id, negocio_id) references movimiento(id, negocio_id),
  foreign key (revierte_id, negocio_id) references movimiento_cta_cte_proveedor(id, negocio_id)
);

-- Trigger de inmutabilidad: prohíbe terminantemente UPDATE y DELETE en movimiento_cta_cte_proveedor
create or replace function tg_movimiento_cta_cte_proveedor_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'movimiento_cta_cte_proveedor es un libro de solo agregar; use un movimiento inverso para anular o corregir';
end $$;

create trigger trg_movimiento_cta_cte_proveedor_inmutable
  before update or delete on movimiento_cta_cte_proveedor
  for each row execute function tg_movimiento_cta_cte_proveedor_inmutable();

-- ---------------------------------------------------------------- vistas calculadas
-- Saldo deudor a proveedores (cuánto le debemos al proveedor)
create or replace view v_saldo_proveedor with (security_invoker = true) as
select
  p.id as proveedor_id,
  p.negocio_id,
  p.codigo,
  p.razon_social,
  p.nombre_fantasia,
  p.cuit,
  p.condicion_iva,
  p.telefono,
  p.email,
  p.contacto_nombre,
  p.dias_plazo_pago,
  p.activo,
  coalesce(sum(case when m.sentido = 'debito' then m.monto else 0 end), 0)::numeric(14,2) as total_compras,
  coalesce(sum(case when m.sentido = 'credito' then m.monto else 0 end), 0)::numeric(14,2) as total_pagos,
  coalesce(sum(case when m.sentido = 'debito' then m.monto else -m.monto end), 0)::numeric(14,2) as saldo_deudor
from proveedor p
left join movimiento_cta_cte_proveedor m on m.proveedor_id = p.id and m.negocio_id = p.negocio_id
where p.activo = true
group by p.id, p.negocio_id;

-- ---------------------------------------------------------------- RLS y permisos
do $$
declare t text;
begin
  foreach t in array array['proveedor', 'producto_proveedor', 'orden_compra', 'item_orden_compra', 'movimiento_cta_cte_proveedor']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aislamiento_negocio on %I using (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)
         with check (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)', t);
  end loop;
end $$;

grant select, insert, update, delete on proveedor to app_user;
grant select, insert, update, delete on producto_proveedor to app_user;
grant select, insert, update, delete on orden_compra to app_user;
grant select, insert, update, delete on item_orden_compra to app_user;
grant select, insert on movimiento_cta_cte_proveedor to app_user;
grant select on v_saldo_proveedor to app_user;

commit;
