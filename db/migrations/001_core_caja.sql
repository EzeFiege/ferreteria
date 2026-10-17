-- 001_core_caja.sql
-- Núcleo de caja y flujo de caja (Fase 1). Requiere PostgreSQL 15+.
-- Cuenta corriente de clientes, stock y compras NO están acá: van en migraciones posteriores.
-- Principios:
--   * movimiento es un libro de solo agregar: no se edita ni se borra, se revierte.
--   * los saldos se calculan (vistas), nunca se guardan.
--   * todo cuelga de negocio_id y está protegido con RLS (multi-negocio desde el día uno).
--   * dinero en numeric(14,2); cantidades en numeric(14,3) (metros, kilos, litros).

begin;

-- ---------------------------------------------------------------- estructura
create table negocio (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  creado_en  timestamptz not null default now()
);

create table sucursal (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocio(id),
  nombre     text not null,
  unique (id, negocio_id)
);

create table caja (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references negocio(id),
  sucursal_id uuid not null,
  nombre      text not null,
  unique (id, negocio_id),
  foreign key (sucursal_id, negocio_id) references sucursal (id, negocio_id)
);

create table usuario (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references negocio(id),
  proveedor_uid text not null unique,          -- uid del proveedor de identidad (p. ej. Firebase Auth)
  nombre       text not null,
  rol          text not null check (rol in ('dueno','encargado','cajero')),
  activo       boolean not null default true
);

-- ---------------------------------------------------------------- catálogos de caja
create table medio_pago (
  id                uuid primary key default gen_random_uuid(),
  negocio_id        uuid not null references negocio(id),
  nombre            text not null,
  es_efectivo       boolean not null default false,  -- suma al cajón físico
  dias_acreditacion integer not null default 0 check (dias_acreditacion >= 0),
  comision_pct      numeric(5,2) not null default 0 check (comision_pct >= 0),
  activo            boolean not null default true,
  unique (negocio_id, nombre),
  unique (id, negocio_id)
);

create table rubro (               -- qué se vendió: herramientas, electricidad, pinturas... (los define cada negocio)
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocio(id),
  nombre     text not null,
  unique (negocio_id, nombre),
  unique (id, negocio_id)
);

create table categoria (           -- por qué entra o sale plata: proveedores, sueldos, servicios...
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocio(id),
  nombre     text not null,
  tipo       text not null check (tipo in ('ingreso','egreso')),
  unique (negocio_id, nombre, tipo),
  unique (id, negocio_id)
);

create table cliente (             -- opcional en la venta; la cuenta corriente llega en la Fase 3
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocio(id),
  nombre     text not null,
  documento  text,
  telefono   text,
  activo     boolean not null default true,
  unique (id, negocio_id)
);

-- ---------------------------------------------------------------- turnos y ventas
create table turno_caja (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references negocio(id),
  caja_id          uuid not null,
  abierto_por      uuid not null references usuario(id),
  abre_en          timestamptz not null default now(),
  efectivo_inicial numeric(14,2) not null check (efectivo_inicial >= 0),
  cerrado_por      uuid references usuario(id),
  cierra_en        timestamptz,
  efectivo_contado numeric(14,2) check (efectivo_contado >= 0),
  notas            text,
  unique (id, negocio_id),
  foreign key (caja_id, negocio_id) references caja (id, negocio_id),
  check ((cierra_en is null) = (cerrado_por is null)),
  check (cierra_en is null or efectivo_contado is not null)   -- no se cierra sin arqueo
);
-- una sola caja abierta a la vez por caja
create unique index turno_abierto_unico on turno_caja (caja_id) where cierra_en is null;

create table venta (
  id         uuid primary key,                  -- lo genera el cliente: permite reintentos sin duplicar
  negocio_id uuid not null references negocio(id),
  turno_id   uuid not null,
  cliente_id uuid,
  total      numeric(14,2) not null check (total >= 0),
  estado     text not null default 'confirmada' check (estado in ('confirmada','anulada')),
  creado_por uuid not null references usuario(id),
  creado_en  timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (turno_id, negocio_id)   references turno_caja (id, negocio_id),
  foreign key (cliente_id, negocio_id) references cliente (id, negocio_id)
);

create table venta_item (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references negocio(id),
  venta_id    uuid not null,
  producto_id uuid,                              -- se enlaza al catálogo en la Fase 2
  descripcion text not null,
  cantidad    numeric(14,3) not null check (cantidad > 0),
  precio_unit numeric(14,2) not null check (precio_unit >= 0),
  subtotal    numeric(14,2) generated always as (round(cantidad * precio_unit, 2)) stored,
  foreign key (venta_id, negocio_id) references venta (id, negocio_id)
);

-- ---------------------------------------------------------------- libro de movimientos
create table movimiento (
  id            uuid primary key,                -- lo genera el cliente (idempotencia offline)
  negocio_id    uuid not null references negocio(id),
  turno_id      uuid not null,
  tipo          text not null check (tipo in
                  ('venta','egreso','retiro','ingreso_extra','ajuste')),
  sentido       text not null check (sentido in ('in','out')),
  monto         numeric(14,2) not null check (monto > 0),
  medio_pago_id uuid not null,
  rubro_id      uuid,
  categoria_id  uuid,
  venta_id      uuid,
  descripcion   text,
  revierte_id   uuid,                           -- si es una corrección: el movimiento que anula
  creado_por    uuid not null references usuario(id),
  creado_en     timestamptz not null default now(),
  unique (id, negocio_id),
  -- cada referencia incluye negocio_id: ninguna fila puede apuntar a datos de otro negocio
  foreign key (turno_id, negocio_id)      references turno_caja (id, negocio_id),
  foreign key (medio_pago_id, negocio_id) references medio_pago (id, negocio_id),
  foreign key (rubro_id, negocio_id)      references rubro (id, negocio_id),
  foreign key (categoria_id, negocio_id)  references categoria (id, negocio_id),
  foreign key (venta_id, negocio_id)      references venta (id, negocio_id),
  foreign key (revierte_id, negocio_id)   references movimiento (id, negocio_id)
);
create unique index movimiento_una_reversion on movimiento (revierte_id) where revierte_id is not null;
create index movimiento_por_turno on movimiento (turno_id);

-- el libro no se edita ni se borra
create function movimiento_inmutable() returns trigger language plpgsql as $$
begin
  raise exception 'movimiento es de solo agregar: corregí con un movimiento inverso (revierte_id)';
end $$;

create trigger trg_movimiento_inmutable
  before update or delete on movimiento
  for each row execute function movimiento_inmutable();

-- coherencia al insertar: el turno debe estar abierto y la reversión debe espejar al original
-- (la pertenencia al mismo negocio la garantizan las claves foráneas compuestas)
create function movimiento_validar() returns trigger language plpgsql as $$
declare
  v_cierra timestamptz;
  v_orig   movimiento%rowtype;
begin
  select cierra_en into v_cierra from turno_caja where id = new.turno_id;
  if not found then
    raise exception 'turno inexistente';
  end if;
  if v_cierra is not null then
    raise exception 'el turno % ya está cerrado', new.turno_id;
  end if;
  if new.revierte_id is not null then
    select * into v_orig from movimiento where id = new.revierte_id;
    if not found
       or v_orig.tipo <> new.tipo
       or v_orig.monto <> new.monto
       or v_orig.sentido = new.sentido then
      raise exception 'una reversión debe copiar tipo y monto del original y tener sentido contrario';
    end if;
  end if;
  return new;
end $$;

create trigger trg_movimiento_validar
  before insert on movimiento
  for each row execute function movimiento_validar();

-- ---------------------------------------------------------------- vistas de reporte (reemplazan los totales del Excel)
-- Cierre de caja: lo que debería haber en el cajón vs. lo contado.
create view v_resumen_turno with (security_invoker = true) as
with mov as (
  select m.turno_id,
         sum(case when mp.es_efectivo and m.sentido = 'in'  then m.monto else 0 end) as entradas_efectivo,
         sum(case when mp.es_efectivo and m.sentido = 'out' then m.monto else 0 end) as salidas_efectivo
  from movimiento m
  join medio_pago mp on mp.id = m.medio_pago_id
  group by m.turno_id
)
select t.id as turno_id, t.negocio_id, t.caja_id, t.abre_en, t.cierra_en,
       t.efectivo_inicial,
       coalesce(v.entradas_efectivo, 0) as entradas_efectivo,
       coalesce(v.salidas_efectivo, 0)  as salidas_efectivo,
       t.efectivo_inicial + coalesce(v.entradas_efectivo, 0) - coalesce(v.salidas_efectivo, 0) as efectivo_esperado,
       t.efectivo_contado,
       t.efectivo_contado - (t.efectivo_inicial + coalesce(v.entradas_efectivo, 0) - coalesce(v.salidas_efectivo, 0)) as diferencia
from turno_caja t
left join mov v on v.turno_id = t.id;

-- Ventas netas por medio de pago y rubro (reemplaza los totales por columna de la planilla).
create view v_ventas_por_medio_rubro with (security_invoker = true) as
select m.negocio_id, m.turno_id,
       mp.nombre as medio_pago,
       coalesce(r.nombre, 'Sin rubro') as rubro,
       sum(case m.sentido when 'in' then m.monto else -m.monto end) as total
from movimiento m
join medio_pago mp on mp.id = m.medio_pago_id
left join rubro r on r.id = m.rubro_id
where m.tipo = 'venta'
group by m.negocio_id, m.turno_id, mp.nombre, r.nombre;

-- ---------------------------------------------------------------- datos iniciales por negocio
create function sembrar_negocio(p_negocio uuid) returns void language sql as $$
  -- dias_acreditacion y comisiones: ajustar con los valores reales del negocio (Etapa 4)
  insert into medio_pago (negocio_id, nombre, es_efectivo, dias_acreditacion) values
    (p_negocio, 'Efectivo',         true,  0),
    (p_negocio, 'Tarjeta',          false, 0),
    (p_negocio, 'Transferencia/QR', false, 0);
  insert into categoria (negocio_id, nombre, tipo) values
    (p_negocio, 'Proveedores',  'egreso'),
    (p_negocio, 'Sueldos',      'egreso'),
    (p_negocio, 'Servicios',    'egreso'),
    (p_negocio, 'Impuestos',    'egreso'),
    (p_negocio, 'Varios',       'egreso'),
    (p_negocio, 'Otros ingresos','ingreso');
$$;

-- ---------------------------------------------------------------- seguridad por fila (RLS)
-- La API ejecuta, por transacción:  select set_config('app.negocio_id', '<uuid>', true);
-- El rol de la aplicación NO debe ser dueño de las tablas ni superusuario (FORCE cubre al dueño).
do $$
declare t text;
begin
  foreach t in array array['sucursal','caja','usuario','medio_pago','rubro','categoria','cliente',
                           'turno_caja','venta','venta_item','movimiento']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aislamiento_negocio on %I using (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)
         with check (negocio_id = nullif(current_setting(''app.negocio_id'', true), '''')::uuid)', t);
  end loop;
end $$;

commit;
