-- 009_presupuestos.sql
-- Presupuestos y Cotizaciones de Mostrador para clientes y gremios

-- 1. Tabla de Presupuestos
create table if not exists presupuesto (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  numero integer not null check (numero > 0),
  fecha_emision timestamptz not null default now(),
  fecha_vencimiento date not null default (current_date + interval '15 days')::date,
  dias_validez integer not null default 15 check (dias_validez between 1 and 365),
  cliente_id uuid references cliente(id) on delete set null,
  nombre_contacto text,
  telefono_contacto text,
  email_contacto text,
  lista_precio_id uuid references lista_precio(id) on delete set null,
  subtotal numeric(14,2) not null default 0.00 check (subtotal >= 0),
  descuento_general numeric(14,2) not null default 0.00 check (descuento_general >= 0),
  total numeric(14,2) not null check (total >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado_convertido', 'vencido', 'cancelado')),
  venta_id uuid references venta(id) on delete set null,
  observaciones text,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  unique (negocio_id, numero)
);

-- RLS para presupuesto
alter table presupuesto enable row level security;

drop policy if exists presupuesto_tenant_isolation on presupuesto;
create policy presupuesto_tenant_isolation on presupuesto
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update on presupuesto to app_user;

create index if not exists idx_presupuesto_negocio_numero on presupuesto(negocio_id, numero);
create index if not exists idx_presupuesto_negocio_estado on presupuesto(negocio_id, estado);
create index if not exists idx_presupuesto_negocio_vencimiento on presupuesto(negocio_id, fecha_vencimiento);

-- 2. Tabla de Ítems del Presupuesto
create table if not exists item_presupuesto (
  id uuid not null default gen_random_uuid(),
  presupuesto_id uuid not null,
  negocio_id uuid not null,
  producto_id uuid references producto(id) on delete set null,
  codigo text,
  nombre text not null,
  unidad text not null default 'unidad',
  cantidad numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  descuento_pct numeric(5,2) not null default 0.00 check (descuento_pct between 0 and 100),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  notas text,
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  foreign key (presupuesto_id, negocio_id) references presupuesto(id, negocio_id) on delete cascade
);

-- RLS para item_presupuesto
alter table item_presupuesto enable row level security;

drop policy if exists item_presupuesto_tenant_isolation on item_presupuesto;
create policy item_presupuesto_tenant_isolation on item_presupuesto
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update, delete on item_presupuesto to app_user;

create index if not exists idx_item_presupuesto_presupuesto on item_presupuesto(negocio_id, presupuesto_id);
create index if not exists idx_item_presupuesto_producto on item_presupuesto(negocio_id, producto_id);
