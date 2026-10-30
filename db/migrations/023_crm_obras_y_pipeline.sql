-- 023_crm_obras_y_pipeline.sql
-- Fase 23: CRM Comercial 360° (Obras por Cliente, Pipeline Kanban y Bitácora de Contacto)

-- 1. Tabla de Obras / Proyectos por Cliente
create table if not exists cliente_obra (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  cliente_id uuid not null,
  nombre text not null,
  direccion text,
  localidad text,
  contacto_responsable text,
  telefono_responsable text,
  fecha_inicio date,
  fecha_fin_estimada date,
  estado text not null default 'activa' check (estado in ('planificacion', 'activa', 'pausada', 'finalizada')),
  presupuesto_estimado numeric(14,2) default 0.00 check (presupuesto_estimado >= 0),
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente(id, negocio_id) on delete cascade
);

alter table cliente_obra enable row level security;

drop policy if exists cliente_obra_tenant_isolation on cliente_obra;
create policy cliente_obra_tenant_isolation on cliente_obra
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update, delete on cliente_obra to app_user;

create index if not exists idx_cliente_obra_negocio_cliente on cliente_obra(negocio_id, cliente_id);
create index if not exists idx_cliente_obra_negocio_estado on cliente_obra(negocio_id, estado);

-- 2. Modificaciones en Presupuesto y Venta para asociar Obra y Pipeline CRM
alter table presupuesto
  add column if not exists obra_id uuid,
  add column if not exists etapa_crm text not null default 'enviado' check (etapa_crm in ('borrador', 'enviado', 'negociacion', 'ganado', 'perdido')),
  add column if not exists motivo_perdido text,
  add column if not exists probabilidad_pct integer not null default 50 check (probabilidad_pct between 0 and 100);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_presupuesto_obra'
  ) then
    alter table presupuesto
      add constraint fk_presupuesto_obra
      foreign key (obra_id, negocio_id) references cliente_obra(id, negocio_id) on delete set null;
  end if;
end $$;

create index if not exists idx_presupuesto_negocio_etapa_crm on presupuesto(negocio_id, etapa_crm);
create index if not exists idx_presupuesto_negocio_obra on presupuesto(negocio_id, obra_id);

alter table venta
  add column if not exists obra_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_venta_obra'
  ) then
    alter table venta
      add constraint fk_venta_obra
      foreign key (obra_id, negocio_id) references cliente_obra(id, negocio_id) on delete set null;
  end if;
end $$;

create index if not exists idx_venta_negocio_obra on venta(negocio_id, obra_id);

-- 3. Bitácora de Contacto y Seguimiento Comercial
create table if not exists cliente_contacto_bitacora (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  cliente_id uuid not null,
  obra_id uuid,
  presupuesto_id uuid,
  tipo text not null default 'llamada' check (tipo in ('llamada', 'whatsapp', 'visita_obra', 'reunion', 'nota')),
  descripcion text not null,
  proximo_contacto_fecha date,
  proximo_contacto_accion text,
  registrado_por text,
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente(id, negocio_id) on delete cascade,
  foreign key (obra_id, negocio_id) references cliente_obra(id, negocio_id) on delete set null,
  foreign key (presupuesto_id, negocio_id) references presupuesto(id, negocio_id) on delete set null
);

alter table cliente_contacto_bitacora enable row level security;

drop policy if exists cliente_contacto_bitacora_tenant_isolation on cliente_contacto_bitacora;
create policy cliente_contacto_bitacora_tenant_isolation on cliente_contacto_bitacora
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, delete on cliente_contacto_bitacora to app_user;

create index if not exists idx_bitacora_negocio_cliente on cliente_contacto_bitacora(negocio_id, cliente_id);
create index if not exists idx_bitacora_negocio_fecha on cliente_contacto_bitacora(negocio_id, creado_en);
create index if not exists idx_bitacora_proximo_contacto on cliente_contacto_bitacora(negocio_id, proximo_contacto_fecha);
