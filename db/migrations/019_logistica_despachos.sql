-- 019_logistica_despachos.sql
-- Fase 20: Logística de Envíos a Domicilio, Despachos y Hoja de Ruta para Fletero

-- 1. Tabla de Envíos / Despachos
create table if not exists despacho_envio (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  numero text not null, -- 'ENV-0001'
  venta_id uuid references venta(id) on delete set null,
  remito_acopio_id uuid references remito_entrega_acopio(id) on delete set null,
  cliente_id uuid not null references cliente(id) on delete cascade,
  direccion_destino text not null,
  localidad text,
  contacto_nombre text not null,
  contacto_telefono text,
  franja_horaria text, -- 'Mañana 08:00 a 12:00', 'Tarde 13:00 a 17:00'
  costo_flete numeric(14,2) not null default 0.00 check (costo_flete >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_camino', 'entregado', 'fallido', 'cancelado')),
  notas_despacho text,
  motivo_fallo text,
  creado_por text not null,
  creado_en timestamptz not null default clock_timestamp(),
  entregado_en timestamptz,
  primary key (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente(id, negocio_id)
);

-- Índices para despacho_envio
create index if not exists idx_despacho_envio_negocio_estado on despacho_envio(negocio_id, estado);
create index if not exists idx_despacho_envio_negocio_cliente on despacho_envio(negocio_id, cliente_id);
create index if not exists idx_despacho_envio_negocio_creado on despacho_envio(negocio_id, creado_en desc);

-- RLS despacho_envio
alter table despacho_envio enable row level security;
alter table despacho_envio force row level security;

drop policy if exists despacho_envio_isolation on despacho_envio;
create policy despacho_envio_isolation on despacho_envio
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

grant select, insert, update on despacho_envio to app_user;

-- 2. Tabla de Hoja de Ruta para Fletero
create table if not exists hoja_ruta_fletero (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  numero text not null, -- 'HDR-0001'
  fecha_salida date not null default current_date,
  fletero_nombre text not null,
  fletero_telefono text,
  vehiculo_patente text,
  estado text not null default 'en_preparacion' check (estado in ('en_preparacion', 'en_viaje', 'finalizada', 'cancelada')),
  observaciones text,
  creado_por text not null,
  creado_en timestamptz not null default clock_timestamp(),
  cerrada_en timestamptz,
  primary key (id, negocio_id)
);

create index if not exists idx_hoja_ruta_negocio_fecha on hoja_ruta_fletero(negocio_id, fecha_salida desc);
create index if not exists idx_hoja_ruta_negocio_estado on hoja_ruta_fletero(negocio_id, estado);

-- RLS hoja_ruta_fletero
alter table hoja_ruta_fletero enable row level security;
alter table hoja_ruta_fletero force row level security;

drop policy if exists hoja_ruta_fletero_isolation on hoja_ruta_fletero;
create policy hoja_ruta_fletero_isolation on hoja_ruta_fletero
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

grant select, insert, update on hoja_ruta_fletero to app_user;

-- 3. Tabla de Ítems / Paradas de la Hoja de Ruta
create table if not exists item_hoja_ruta (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  hoja_ruta_id uuid not null,
  despacho_id uuid not null,
  orden_parada integer not null default 1,
  estado_parada text not null default 'pendiente' check (estado_parada in ('pendiente', 'entregado', 'no_entregado')),
  entregado_en timestamptz,
  observaciones_entrega text,
  primary key (id, negocio_id),
  foreign key (hoja_ruta_id, negocio_id) references hoja_ruta_fletero(id, negocio_id) on delete cascade,
  foreign key (despacho_id, negocio_id) references despacho_envio(id, negocio_id) on delete cascade
);

create index if not exists idx_item_hoja_ruta_orden on item_hoja_ruta(negocio_id, hoja_ruta_id, orden_parada);

-- RLS item_hoja_ruta
alter table item_hoja_ruta enable row level security;
alter table item_hoja_ruta force row level security;

drop policy if exists item_hoja_ruta_isolation on item_hoja_ruta;
create policy item_hoja_ruta_isolation on item_hoja_ruta
  for all
  using (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (negocio_id = nullif(current_setting('app.negocio_id', true), '')::uuid);

grant select, insert, update, delete on item_hoja_ruta to app_user;

-- 4. Vista de Despachos con datos del cliente y hoja de ruta asociada
create or replace view v_despachos_resumen
with (security_invoker = true) as
select
  d.id,
  d.negocio_id,
  d.numero,
  d.venta_id,
  d.remito_acopio_id,
  d.cliente_id,
  c.nombre as cliente_nombre,
  c.cuit_dni as cliente_cuit_dni,
  d.direccion_destino,
  d.localidad,
  d.contacto_nombre,
  d.contacto_telefono,
  d.franja_horaria,
  d.costo_flete,
  d.estado,
  d.notas_despacho,
  d.motivo_fallo,
  d.creado_por,
  d.creado_en,
  d.entregado_en,
  hr.id as hoja_ruta_id,
  hr.numero as hoja_ruta_numero,
  hr.fletero_nombre,
  hr.vehiculo_patente,
  ihr.orden_parada
from despacho_envio d
join cliente c on c.id = d.cliente_id and c.negocio_id = d.negocio_id
left join item_hoja_ruta ihr on ihr.despacho_id = d.id and ihr.negocio_id = d.negocio_id
left join hoja_ruta_fletero hr on hr.id = ihr.hoja_ruta_id and hr.negocio_id = d.negocio_id;

grant select on v_despachos_resumen to app_user;
