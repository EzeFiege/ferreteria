-- 024_margen_por_producto.sql
-- Fase 22: Margen de ganancia individual por producto (margen base propio sobre el costo).

begin;

-- 1. Agregar columna margen_ganancia_pct a tabla producto
alter table producto
  add column if not exists margen_ganancia_pct numeric(5,2)
  check (margen_ganancia_pct is null or margen_ganancia_pct >= 0);

-- 2. Actualizar vista v_precios_producto para aplicar el margen base del producto si está definido
drop view if exists v_precios_producto;
create view v_precios_producto with (security_invoker = true) as
select
  p.id as producto_id,
  p.negocio_id,
  lp.id as lista_precio_id,
  lp.nombre as lista_nombre,
  coalesce(p.margen_ganancia_pct, lp.margen_pct) as margen_pct,
  lp.redondeo,
  coalesce(
    ppl.precio_fijo,
    fn_aplicar_redondeo_precio(p.costo_base * (1 + coalesce(p.margen_ganancia_pct, lp.margen_pct) / 100), lp.redondeo)
  ) as precio_venta_principal,
  round(
    coalesce(
      ppl.precio_fijo,
      fn_aplicar_redondeo_precio(p.costo_base * (1 + coalesce(p.margen_ganancia_pct, lp.margen_pct) / 100), lp.redondeo)
    ) / p.factor_conversion,
    2
  ) as precio_venta_secundaria,
  case when ppl.precio_fijo is not null then true else false end as es_precio_fijo
from producto p
cross join lista_precio lp
left join precio_producto_lista ppl
  on ppl.producto_id = p.id
 and ppl.lista_precio_id = lp.id
 and ppl.negocio_id = p.negocio_id
where lp.negocio_id = p.negocio_id and lp.activo = true and p.activo = true;

grant select on v_precios_producto to app_user;

commit;
