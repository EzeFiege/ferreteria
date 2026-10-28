-- 021_producto_sku.sql
-- Agrega columna sku (código de fabricante / distribuidor / modelo) a la tabla producto
-- y crea índice para búsqueda rápida por SKU.

begin;

alter table producto
  add column if not exists sku text;

create index if not exists idx_producto_sku on producto(negocio_id, sku);

commit;
