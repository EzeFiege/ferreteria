-- 012_usuarios_autenticacion.sql
-- Fase 13: Autenticación directa con usuario/contraseña, sesión y roles

alter table usuario add column if not exists email text;
alter table usuario add column if not exists password_hash text;
alter table usuario add column if not exists ultimo_ingreso timestamptz;

-- Permisos para app_user sobre los nuevos campos de usuario
grant select, update on usuario to app_user;

-- Índices para búsqueda rápida en login
create index if not exists idx_usuario_email on usuario (lower(email));
create index if not exists idx_usuario_nombre on usuario (lower(nombre));

-- Actualizar usuarios demo existentes con email y contraseña segura
-- Clave para cajero y encargada: 123456
-- Clave para dueño: admin123
update usuario
set
  email = 'cajero@ferreteria.local',
  password_hash = 'a1b2c3d4e5f6789012345678abcdef01:f2c094a6c883a7ebd3af0166029684ee55b370124056d7871b098ac2ffe181b5b91ae8b0fc8410292f38441e3b802c542db80c97f131d9c1a8d2d540d6627fa8'
where proveedor_uid = 'demo-cajero';

update usuario
set
  email = 'encargada@ferreteria.local',
  password_hash = 'a1b2c3d4e5f6789012345678abcdef01:f2c094a6c883a7ebd3af0166029684ee55b370124056d7871b098ac2ffe181b5b91ae8b0fc8410292f38441e3b802c542db80c97f131d9c1a8d2d540d6627fa8'
where proveedor_uid = 'demo-encargado';

update usuario
set
  email = 'dueno@ferreteria.local',
  password_hash = 'a1b2c3d4e5f6789012345678abcdef01:03acdee912b0d6bc01b2f5b45efa8e64de49c1e360f81a97752cd81f230c64bd1dc452d5af3d8d9de0f627bb43e4a0529684b791d07ab4d0b50863e776de94e7'
where proveedor_uid = 'demo-dueno';

-- Función segura para autenticación previa a la apertura de sesión RLS
create or replace function autenticar_usuario(
  p_identificador text,
  p_negocio_id uuid default null
)
returns table (
  id uuid,
  negocio_id uuid,
  negocio_nombre text,
  proveedor_uid text,
  nombre text,
  email text,
  rol text,
  activo boolean,
  password_hash text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select 
    u.id,
    u.negocio_id,
    n.nombre as negocio_nombre,
    u.proveedor_uid,
    u.nombre,
    u.email,
    u.rol,
    u.activo,
    u.password_hash
  from usuario u
  join negocio n on n.id = u.negocio_id
  where (
    lower(coalesce(u.email, '')) = lower(trim(p_identificador))
    or lower(u.nombre) = lower(trim(p_identificador))
    or u.proveedor_uid = trim(p_identificador)
  )
  and (p_negocio_id is null or u.negocio_id = p_negocio_id)
  and u.activo = true
  limit 1;
end;
$$;

grant execute on function autenticar_usuario(text, uuid) to app_user;
