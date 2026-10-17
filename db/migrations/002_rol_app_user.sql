-- 002_rol_app_user.sql
-- Crea y configura el rol de aplicación (app_user) sin privilegios de superusuario ni bypassrls.
-- Garantiza que las políticas de RLS de 001_core_caja.sql se apliquen siempre en las conexiones de la API.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  else
    alter role app_user
      login
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end $$;

-- Permisos de uso en el esquema público
grant usage on schema public to app_user;

-- Permisos sobre tablas del dominio (movimiento está protegido por trigger trg_movimiento_inmutable ante UPDATE/DELETE)
grant select, insert, update, delete on
  sucursal,
  caja,
  usuario,
  medio_pago,
  rubro,
  categoria,
  cliente,
  turno_caja,
  venta,
  venta_item
to app_user;

-- En movimiento solo permitimos SELECT e INSERT también a nivel de privilegios SQL (defensa en profundidad junto al trigger)
grant select, insert on movimiento to app_user;

-- En negocio permitimos lectura e inserción (para alta/consulta de negocio)
grant select, insert, update on negocio to app_user;

-- Permisos sobre vistas de reporte (security_invoker = true evalúa RLS con app_user)
grant select on v_resumen_turno, v_ventas_por_medio_rubro to app_user;

-- Permisos para ejecutar funciones de dominio
grant execute on function sembrar_negocio(uuid) to app_user;

-- Privilegios por defecto para futuras tablas y secuencias creadas en migraciones posteriores
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_user;

alter default privileges in schema public
  grant usage, select on sequences to app_user;

commit;
