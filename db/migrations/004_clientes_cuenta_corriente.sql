-- 004_clientes_cuenta_corriente.sql
-- Fase 3: CRM de clientes, personas autorizadas a retirar y cuenta corriente inmutable.
-- Principios innegociables de AGENTS.md:
--   * movimiento_cta_cte es un libro de solo agregar (inmutable).
--   * los saldos no se guardan ni se tipean: se calculan en v_saldo_cliente.
--   * dinero en numeric(14,2).
--   * multi-negocio con RLS activo para app_user.

begin;

-- ---------------------------------------------------------------- ampliar cliente existente
alter table cliente add column if not exists codigo text;
alter table cliente add column if not exists cuit_dni text;
alter table cliente add column if not exists condicion_iva text not null default 'consumidor_final' check (condicion_iva in ('consumidor_final', 'responsable_inscripto', 'monotributo', 'exento'));
alter table cliente add column if not exists email text;
alter table cliente add column if not exists direccion text;
alter table cliente add column if not exists lista_precio_id uuid;
alter table cliente add column if not exists limite_credito numeric(14,2) not null default 0 check (limite_credito >= 0);
alter table cliente add column if not exists dias_plazo_credito integer not null default 30 check (dias_plazo_credito >= 0);
alter table cliente add column if not exists notas text;
alter table cliente add column if not exists creado_en timestamptz not null default now();

-- Completar datos iniciales si existían filas previas
update cliente set cuit_dni = documento where cuit_dni is null and documento is not null;
update cliente set codigo = 'CLI-' || substr(id::text, 1, 8) where codigo is null;

alter table cliente alter column codigo set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cliente_negocio_id_codigo_key'
  ) then
    alter table cliente add constraint cliente_negocio_id_codigo_key unique (negocio_id, codigo);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'cliente_lista_precio_fk'
  ) then
    alter table cliente add constraint cliente_lista_precio_fk foreign key (lista_precio_id, negocio_id) references lista_precio(id, negocio_id);
  end if;
end $$;

-- ---------------------------------------------------------------- personas autorizadas a retirar
create table cliente_autorizado (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references negocio(id),
  cliente_id     uuid not null,
  nombre         text not null,                             -- Nombre de la persona autorizada (ej: albañil, chofer)
  dni            text,                                      -- DNI para verificar en mostrador
  rol_parentesco text,                                      -- Ej: 'Encargado de obra', 'Albañil', 'Familiar', 'Chofer'
  telefono       text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente(id, negocio_id) on delete cascade
);

-- ---------------------------------------------------------------- vincular autorizado en venta
alter table venta add column if not exists autorizado_retiro_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'venta_autorizado_retiro_fk'
  ) then
    alter table venta add constraint venta_autorizado_retiro_fk foreign key (autorizado_retiro_id, negocio_id) references cliente_autorizado(id, negocio_id);
  end if;
end $$;

-- ---------------------------------------------------------------- cuenta corriente inmutable
create table movimiento_cta_cte (
  id                   uuid primary key default gen_random_uuid(),
  negocio_id           uuid not null references negocio(id),
  cliente_id           uuid not null,
  tipo                 text not null check (tipo in ('debito_venta', 'credito_cobranza', 'ajuste_debito', 'ajuste_credito')),
  sentido              text not null check (sentido in ('debito', 'credito')),
  monto                numeric(14,2) not null check (monto > 0),
  venta_id             uuid,
  movimiento_caja_id   uuid,                                -- Movimiento de caja asociado cuando el cobro ingresa al turno
  autorizado_retiro_id uuid,                                -- Quién retiró físicamente los materiales
  descripcion          text,
  revierte_id          uuid,
  creado_por           uuid not null,
  creado_en            timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente(id, negocio_id),
  foreign key (venta_id, negocio_id) references venta(id, negocio_id),
  foreign key (movimiento_caja_id, negocio_id) references movimiento(id, negocio_id),
  foreign key (autorizado_retiro_id, negocio_id) references cliente_autorizado(id, negocio_id),
  foreign key (revierte_id, negocio_id) references movimiento_cta_cte(id, negocio_id),
  foreign key (creado_por) references usuario(id)
);

-- Trigger de inmutabilidad: prohíbe terminantemente UPDATE y DELETE en movimiento_cta_cte
create or replace function tg_movimiento_cta_cte_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'movimiento_cta_cte es un libro de solo agregar; use un movimiento inverso para anular o corregir';
end $$;

create trigger trg_movimiento_cta_cte_inmutable
  before update or delete on movimiento_cta_cte
  for each row execute function tg_movimiento_cta_cte_inmutable();

-- ---------------------------------------------------------------- vistas calculadas
-- Saldo deudor actual y control de crédito disponible
create or replace view v_saldo_cliente with (security_invoker = true) as
select
  c.id as cliente_id,
  c.negocio_id,
  c.codigo,
  c.nombre,
  c.cuit_dni,
  c.condicion_iva,
  c.telefono,
  c.email,
  c.direccion,
  c.lista_precio_id,
  c.limite_credito,
  c.dias_plazo_credito,
  c.activo,
  coalesce(sum(case when mcc.sentido = 'debito' then mcc.monto else 0 end), 0)::numeric(14,2) as total_debitos,
  coalesce(sum(case when mcc.sentido = 'credito' then mcc.monto else 0 end), 0)::numeric(14,2) as total_creditos,
  coalesce(sum(case when mcc.sentido = 'debito' then mcc.monto else -mcc.monto end), 0)::numeric(14,2) as saldo_deudor,
  case 
    when c.limite_credito > 0 
      then (c.limite_credito - coalesce(sum(case when mcc.sentido = 'debito' then mcc.monto else -mcc.monto end), 0))::numeric(14,2)
    else (0)::numeric(14,2)
  end as credito_disponible,
  (c.limite_credito > 0 and coalesce(sum(case when mcc.sentido = 'debito' then mcc.monto else -mcc.monto end), 0) > c.limite_credito) as excedido_limite
from cliente c
left join movimiento_cta_cte mcc on mcc.cliente_id = c.id and mcc.negocio_id = c.negocio_id
where c.activo = true
group by c.id, c.negocio_id;

-- ---------------------------------------------------------------- actualizar sembrar_negocio
create or replace function sembrar_negocio(p_negocio uuid) returns void language sql as $$
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
  foreach t in array array['cliente_autorizado', 'movimiento_cta_cte']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aislamiento_negocio on %I using (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)
         with check (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)', t);
  end loop;
end $$;

grant select, insert, update, delete on cliente_autorizado to app_user;
grant select, insert on movimiento_cta_cte to app_user;
grant select on v_saldo_cliente to app_user;

commit;
