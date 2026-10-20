-- 008_contabilidad.sql
-- Fase 7: Contabilidad (Plan de cuentas, Asientos de partida doble inmutables, Libro Diario y Sumas y Saldos)

-- 1. Plan de Cuentas Contable
create table if not exists cuenta_contable (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  tipo text not null check (tipo in ('activo', 'pasivo', 'patrimonio_neto', 'ingreso', 'egreso')),
  descripcion text,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  unique (negocio_id, codigo)
);

-- RLS para cuenta_contable
alter table cuenta_contable enable row level security;

drop policy if exists cuenta_contable_tenant_isolation on cuenta_contable;
create policy cuenta_contable_tenant_isolation on cuenta_contable
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update on cuenta_contable to app_user;

create index if not exists idx_cuenta_contable_negocio_codigo on cuenta_contable(negocio_id, codigo);

-- 2. Tabla Inmutable de Asientos Contables
create table if not exists asiento_contable (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  numero integer not null check (numero > 0),
  fecha timestamptz not null default clock_timestamp(),
  concepto text not null,
  origen text not null check (origen in ('venta', 'egreso_caja', 'cobro_cta_cte', 'compra_stock', 'pago_proveedor', 'deposito_cheque', 'ajuste', 'manual')),
  referencia_id uuid,
  creado_por text,
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  unique (negocio_id, numero)
);

-- RLS para asiento_contable
alter table asiento_contable enable row level security;

drop policy if exists asiento_contable_tenant_isolation on asiento_contable;
create policy asiento_contable_tenant_isolation on asiento_contable
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert on asiento_contable to app_user;

create index if not exists idx_asiento_contable_negocio_fecha on asiento_contable(negocio_id, fecha);
create index if not exists idx_asiento_contable_negocio_origen on asiento_contable(negocio_id, origen);

-- Trigger de Inmutabilidad para Asientos Contables (Regla inviolable: no UPDATE ni DELETE)
create or replace function fn_asiento_contable_inmutable()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Violación contable: los asientos del libro diario no pueden eliminarse (id: %)', old.id;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Violación contable: los asientos contables son inmutables (id: %)', old.id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tg_asiento_contable_inmutable on asiento_contable;
create trigger tg_asiento_contable_inmutable
before update or delete on asiento_contable
for each row execute function fn_asiento_contable_inmutable();

-- 3. Tabla Inmutable de Renglones de Asiento (Partida Doble)
create table if not exists renglon_asiento (
  id uuid not null default gen_random_uuid(),
  asiento_id uuid not null,
  negocio_id uuid not null,
  cuenta_id uuid not null,
  debe numeric(14,2) not null default 0.00 check (debe >= 0),
  haber numeric(14,2) not null default 0.00 check (haber >= 0),
  descripcion text,
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  foreign key (asiento_id, negocio_id) references asiento_contable(id, negocio_id) on delete restrict,
  foreign key (cuenta_id, negocio_id) references cuenta_contable(id, negocio_id),
  check ((debe > 0 and haber = 0) or (haber > 0 and debe = 0))
);

-- RLS para renglon_asiento
alter table renglon_asiento enable row level security;

drop policy if exists renglon_asiento_tenant_isolation on renglon_asiento;
create policy renglon_asiento_tenant_isolation on renglon_asiento
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert on renglon_asiento to app_user;

create index if not exists idx_renglon_asiento_asiento on renglon_asiento(negocio_id, asiento_id);
create index if not exists idx_renglon_asiento_cuenta on renglon_asiento(negocio_id, cuenta_id);

-- Trigger de Inmutabilidad para Renglones de Asiento
create or replace function fn_renglon_asiento_inmutable()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Violación contable: los renglones de asientos no pueden eliminarse (id: %)', old.id;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Violación contable: los renglones de asientos son inmutables (id: %)', old.id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tg_renglon_asiento_inmutable on renglon_asiento;
create trigger tg_renglon_asiento_inmutable
before update or delete on renglon_asiento
for each row execute function fn_renglon_asiento_inmutable();

-- 4. Vistas Contables Oficiales: Libro Diario y Sumas y Saldos (Balance de Comprobación)

create or replace view v_libro_diario with (security_invoker = true) as
select
  a.negocio_id,
  a.id as asiento_id,
  a.numero as asiento_numero,
  a.fecha as asiento_fecha,
  a.concepto as asiento_concepto,
  a.origen as asiento_origen,
  a.referencia_id as asiento_referencia_id,
  a.creado_por as asiento_creado_por,
  r.id as renglon_id,
  c.id as cuenta_id,
  c.codigo as cuenta_codigo,
  c.nombre as cuenta_nombre,
  c.tipo as cuenta_tipo,
  r.debe,
  r.haber,
  r.descripcion as renglon_descripcion
from asiento_contable a
join renglon_asiento r on r.asiento_id = a.id and r.negocio_id = a.negocio_id
join cuenta_contable c on c.id = r.cuenta_id and c.negocio_id = r.negocio_id
order by a.fecha asc, a.numero asc, r.debe desc;

create or replace view v_sumas_y_saldos with (security_invoker = true) as
select
  c.negocio_id,
  c.id as cuenta_id,
  c.codigo as cuenta_codigo,
  c.nombre as cuenta_nombre,
  c.tipo as cuenta_tipo,
  c.activa as cuenta_activa,
  coalesce(sum(r.debe), 0.00)::numeric(14,2) as total_debe,
  coalesce(sum(r.haber), 0.00)::numeric(14,2) as total_haber,
  case
    when coalesce(sum(r.debe), 0) > coalesce(sum(r.haber), 0)
    then (coalesce(sum(r.debe), 0) - coalesce(sum(r.haber), 0))::numeric(14,2)
    else 0.00::numeric(14,2)
  end as saldo_deudor,
  case
    when coalesce(sum(r.haber), 0) > coalesce(sum(r.debe), 0)
    then (coalesce(sum(r.haber), 0) - coalesce(sum(r.debe), 0))::numeric(14,2)
    else 0.00::numeric(14,2)
  end as saldo_acreedor
from cuenta_contable c
left join renglon_asiento r on r.cuenta_id = c.id and r.negocio_id = c.negocio_id
group by c.negocio_id, c.id, c.codigo, c.nombre, c.tipo, c.activa
order by c.codigo asc;

grant select on v_libro_diario to app_user;
grant select on v_sumas_y_saldos to app_user;
