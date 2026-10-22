-- 013_semilla_negocio_y_usuarios_demo.sql
-- Garantiza la existencia del negocio demo, sucursal, caja y usuarios autenticables
-- en cualquier base de datos nueva o desplegada en la nube (Railway / Docker).

-- 1. Negocio Demo
insert into negocio (id, nombre)
values ('10000000-0000-4000-8000-000000000001', 'Ferretería El Tornillo')
on conflict (id) do nothing;

-- 2. Sucursal y Caja inicial
insert into sucursal (id, negocio_id, nombre)
values ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Casa Central')
on conflict (id) do nothing;

insert into caja (id, negocio_id, sucursal_id, nombre)
values ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Caja Mostrador 1')
on conflict (id) do nothing;

-- 3. Sembrar listas de precios y categorías básicas
select sembrar_negocio('10000000-0000-4000-8000-000000000001');

-- 4. Usuarios con credenciales criptográficas (scrypt)
-- Cajero: cajero@ferreteria.local (o 'demo-cajero') / Clave: 123456
insert into usuario (
  id,
  negocio_id,
  proveedor_uid,
  nombre,
  rol,
  email,
  password_hash,
  activo
) values (
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  'demo-cajero',
  'Juan (Cajero)',
  'cajero',
  'cajero@ferreteria.local',
  'a1b2c3d4e5f6789012345678abcdef01:f2c094a6c883a7ebd3af0166029684ee55b370124056d7871b098ac2ffe181b5b91ae8b0fc8410292f38441e3b802c542db80c97f131d9c1a8d2d540d6627fa8',
  true
)
on conflict (id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  nombre = excluded.nombre,
  rol = excluded.rol,
  activo = true;

-- Encargada: encargada@ferreteria.local (o 'demo-encargado') / Clave: 123456
insert into usuario (
  id,
  negocio_id,
  proveedor_uid,
  nombre,
  rol,
  email,
  password_hash,
  activo
) values (
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  'demo-encargado',
  'Marta (Encargada)',
  'encargado',
  'encargada@ferreteria.local',
  'a1b2c3d4e5f6789012345678abcdef01:f2c094a6c883a7ebd3af0166029684ee55b370124056d7871b098ac2ffe181b5b91ae8b0fc8410292f38441e3b802c542db80c97f131d9c1a8d2d540d6627fa8',
  true
)
on conflict (id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  nombre = excluded.nombre,
  rol = excluded.rol,
  activo = true;

-- Dueño: dueno@ferreteria.local (o 'demo-dueno') / Clave: admin123
insert into usuario (
  id,
  negocio_id,
  proveedor_uid,
  nombre,
  rol,
  email,
  password_hash,
  activo
) values (
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000001',
  'demo-dueno',
  'Roberto (Dueño)',
  'dueno',
  'dueno@ferreteria.local',
  'a1b2c3d4e5f6789012345678abcdef01:03acdee912b0d6bc01b2f5b45efa8e64de49c1e360f81a97752cd81f230c64bd1dc452d5af3d8d9de0f627bb43e4a0529684b791d07ab4d0b50863e776de94e7',
  true
)
on conflict (id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  nombre = excluded.nombre,
  rol = excluded.rol,
  activo = true;
