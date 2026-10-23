-- 014_configuracion_empresa.sql
-- Fase 15: Configuración integral de empresa, datos comerciales, logo, leyenda de tickets y gestión de usuarios

-- 1. Nuevas columnas comerciales y de branding en la tabla negocio
alter table negocio add column if not exists razon_social text;
alter table negocio add column if not exists cuit text;
alter table negocio add column if not exists condicion_iva text not null default 'responsable_inscripto';
alter table negocio add column if not exists iibb text;
alter table negocio add column if not exists inicio_actividades date;
alter table negocio add column if not exists domicilio_comercial text;
alter table negocio add column if not exists telefono text;
alter table negocio add column if not exists email text;
alter table negocio add column if not exists logo_url text;
alter table negocio add column if not exists leyenda_ticket text;

-- 2. Permisos y RLS sobre la tabla negocio
alter table negocio enable row level security;
alter table negocio force row level security;

drop policy if exists aislamiento_negocio_propio on negocio;
drop policy if exists aislamiento_negocio_select on negocio;
drop policy if exists aislamiento_negocio_update on negocio;
drop policy if exists aislamiento_negocio_insert on negocio;
drop policy if exists aislamiento_negocio_delete on negocio;

create policy aislamiento_negocio_select on negocio
  for select
  using (true);

create policy aislamiento_negocio_insert on negocio
  for insert
  with check (true);

create policy aislamiento_negocio_update on negocio
  for update
  using (id = nullif(current_setting('app.negocio_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.negocio_id', true), '')::uuid);

create policy aislamiento_negocio_delete on negocio
  for delete
  using (false);

grant select, insert, update on negocio to app_user;
grant insert on usuario to app_user;

-- 3. Actualizar datos comerciales del negocio demo
update negocio
set
  razon_social = 'Ferretería El Tornillo S.R.L.',
  cuit = '30-71234567-9',
  condicion_iva = 'responsable_inscripto',
  iibb = '901-123456-7',
  domicilio_comercial = 'Av. San Martín 1234, Posadas, Misiones',
  telefono = '+54 376 4123456',
  email = 'contacto@ferreteria.local',
  leyenda_ticket = '¡Gracias por su compra! Los cambios se realizan dentro de los 30 días presentando este ticket.'
where id = '10000000-0000-4000-8000-000000000001';
