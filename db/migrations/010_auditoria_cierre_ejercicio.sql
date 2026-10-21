-- 010_auditoria_cierre_ejercicio.sql
-- Fase 11: Auditoría Centralizada Inmutable y Cierre de Ejercicio Contable

-- 1. Ampliación de orígenes permitidos en Asiento Contable
alter table asiento_contable drop constraint if exists asiento_contable_origen_check;
alter table asiento_contable add constraint asiento_contable_origen_check
  check (origen in (
    'venta', 'egreso_caja', 'cobro_cta_cte', 'compra_stock', 'pago_proveedor',
    'deposito_cheque', 'ajuste', 'manual', 'cierre_ejercicio', 'refundicion_resultados'
  ));

-- 2. Tabla Inmutable de Registro de Auditoría
create table if not exists registro_auditoria (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  usuario_id text not null,
  usuario_email text,
  rol text not null,
  accion text not null, -- 'anulacion_venta', 'arqueo_caja', 'ajuste_cta_cte_cliente', 'ajuste_cta_cte_proveedor', 'cambio_precio', 'cierre_ejercicio', 'apertura_ejercicio', 'cheque_rechazado', 'asiento_manual'
  entidad text not null, -- 'venta', 'turno_caja', 'cliente', 'proveedor', 'articulo', 'ejercicio_contable', 'cheque', 'asiento_contable'
  entidad_id uuid,
  detalles jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default clock_timestamp(),
  primary key (id, negocio_id)
);

-- RLS para registro_auditoria
alter table registro_auditoria enable row level security;

drop policy if exists registro_auditoria_tenant_isolation on registro_auditoria;
create policy registro_auditoria_tenant_isolation on registro_auditoria
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert on registro_auditoria to app_user;

create index if not exists idx_registro_auditoria_negocio_creado on registro_auditoria(negocio_id, creado_en desc);
create index if not exists idx_registro_auditoria_negocio_accion on registro_auditoria(negocio_id, accion);
create index if not exists idx_registro_auditoria_negocio_entidad on registro_auditoria(negocio_id, entidad, entidad_id);

-- Trigger de Inmutabilidad para Registro de Auditoría (Regla: sólo agregar, nunca UPDATE ni DELETE)
create or replace function fn_registro_auditoria_inmutable()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Violación de auditoría: los registros de auditoría no pueden eliminarse (id: %)', old.id;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Violación de auditoría: los registros de auditoría son inmutables (id: %)', old.id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tg_registro_auditoria_inmutable on registro_auditoria;
create trigger tg_registro_auditoria_inmutable
before update or delete on registro_auditoria
for each row execute function fn_registro_auditoria_inmutable();

-- 3. Tabla de Ejercicio Contable
create table if not exists ejercicio_contable (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  numero integer not null check (numero > 0),
  nombre text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  asiento_refundicion_id uuid,
  asiento_cierre_id uuid,
  cerrado_por text,
  cerrado_en timestamptz,
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  unique (negocio_id, numero),
  check (fecha_fin >= fecha_inicio),
  foreign key (asiento_refundicion_id, negocio_id) references asiento_contable(id, negocio_id),
  foreign key (asiento_cierre_id, negocio_id) references asiento_contable(id, negocio_id)
);

-- RLS para ejercicio_contable
alter table ejercicio_contable enable row level security;

drop policy if exists ejercicio_contable_tenant_isolation on ejercicio_contable;
create policy ejercicio_contable_tenant_isolation on ejercicio_contable
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update on ejercicio_contable to app_user;

create index if not exists idx_ejercicio_contable_negocio_fechas on ejercicio_contable(negocio_id, fecha_inicio, fecha_fin);

-- 4. Trigger para impedir asientos contables en ejercicios cerrados
create or replace function fn_verificar_asiento_ejercicio_abierto()
returns trigger as $$
declare
  v_cerrado boolean;
begin
  select exists(
    select 1 from ejercicio_contable
    where negocio_id = new.negocio_id
      and estado = 'cerrado'
      and new.fecha::date between fecha_inicio and fecha_fin
  ) into v_cerrado;

  if v_cerrado then
    raise exception 'No se pueden registrar asientos en un ejercicio contable cerrado (fecha: %)', new.fecha;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tg_asiento_contable_ejercicio_abierto on asiento_contable;
create trigger tg_asiento_contable_ejercicio_abierto
before insert on asiento_contable
for each row execute function fn_verificar_asiento_ejercicio_abierto();
