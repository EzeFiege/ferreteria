-- 022_redondeo_listas_precios.sql
-- Permite configurar reglas de redondeo comercial por lista de precios (efectivo / mostrador)
-- para simplificar el cobro y manejo de cambio en ferreterías.

begin;

-- 1. Agregar columna redondeo en lista_precio
alter table lista_precio
  add column if not exists redondeo text not null default 'ninguno';

-- 2. Función inmutable de redondeo comercial para PostgreSQL
create or replace function fn_aplicar_redondeo_precio(p_monto numeric, p_regla text)
returns numeric(14,2) as $$
declare
  v_base numeric;
begin
  if p_monto is null or p_monto <= 0 or p_regla is null or p_regla = 'ninguno' then
    return round(p_monto, 2)::numeric(14,2);
  end if;

  case p_regla
    when 'entero' then
      return round(p_monto)::numeric(14,2);
    when 'multiplo_10' then
      return (round(p_monto / 10.0) * 10.0)::numeric(14,2);
    when 'multiplo_50' then
      return (round(p_monto / 50.0) * 50.0)::numeric(14,2);
    when 'multiplo_100' then
      return (round(p_monto / 100.0) * 100.0)::numeric(14,2);
    when 'multiplo_500' then
      return (round(p_monto / 500.0) * 500.0)::numeric(14,2);
    when 'multiplo_1000' then
      return (round(p_monto / 1000.0) * 1000.0)::numeric(14,2);
    when 'hacia_arriba_10' then
      return (ceil(p_monto / 10.0) * 10.0)::numeric(14,2);
    when 'hacia_arriba_50' then
      return (ceil(p_monto / 50.0) * 50.0)::numeric(14,2);
    when 'hacia_arriba_100' then
      return (ceil(p_monto / 100.0) * 100.0)::numeric(14,2);
    when 'hacia_arriba_500' then
      return (ceil(p_monto / 500.0) * 500.0)::numeric(14,2);
    when 'hacia_arriba_1000' then
      return (ceil(p_monto / 1000.0) * 1000.0)::numeric(14,2);
    else
      return round(p_monto, 2)::numeric(14,2);
  end case;
end;
$$ language plpgsql immutable;

-- 3. Actualizar vista v_precios_producto para aplicar el redondeo dinámico de cada lista
drop view if exists v_precios_producto;
create view v_precios_producto with (security_invoker = true) as
select
  p.id as producto_id,
  p.negocio_id,
  lp.id as lista_precio_id,
  lp.nombre as lista_nombre,
  lp.margen_pct,
  lp.redondeo,
  coalesce(
    ppl.precio_fijo,
    fn_aplicar_redondeo_precio(p.costo_base * (1 + lp.margen_pct / 100), lp.redondeo)
  ) as precio_venta_principal,
  round(
    coalesce(
      ppl.precio_fijo,
      fn_aplicar_redondeo_precio(p.costo_base * (1 + lp.margen_pct / 100), lp.redondeo)
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
