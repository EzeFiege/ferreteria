-- 017_reabastecimiento_inteligente.sql
-- Fase 17B: Sugerencia Inteligente de Reabastecimiento y Órdenes de Compra Automáticas

begin;

-- 1. Agregar columnas de punto de pedido y tiempo de reposición a producto
alter table producto add column if not exists punto_pedido numeric(14,3) not null default 0 check (punto_pedido >= 0);
alter table producto add column if not exists lead_time_dias integer not null default 7 check (lead_time_dias >= 0);

-- 2. Vista analítica para reabastecimiento inteligente de stock
drop view if exists v_articulos_reabastecimiento;
create view v_articulos_reabastecimiento with (security_invoker = true) as
with ventas_ultimos_30d as (
  select
    negocio_id,
    producto_id,
    coalesce(sum(cantidad_base), 0) as unidades_vendidas_30d
  from movimiento_stock
  where tipo = 'egreso_venta'
    and creado_en >= (now() - interval '30 days')
  group by negocio_id, producto_id
),
proveedor_habitual as (
  select distinct on (producto_id, negocio_id)
    producto_id,
    negocio_id,
    proveedor_id,
    costo_proveedor,
    codigo_proveedor
  from producto_proveedor
  order by producto_id, negocio_id, es_principal desc, actualizado_en desc
)
select
  p.id as producto_id,
  p.negocio_id,
  p.codigo,
  p.nombre,
  p.unidad_principal,
  r.nombre as rubro_nombre,
  coalesce(s.stock_actual_base, 0) as stock_actual,
  p.stock_minimo,
  p.punto_pedido,
  p.lead_time_dias,
  p.costo_base,
  coalesce(v30.unidades_vendidas_30d, 0) as unidades_vendidas_30d,
  round(coalesce(v30.unidades_vendidas_30d, 0) / 30.0, 3) as consumo_diario_promedio,
  case
    when coalesce(v30.unidades_vendidas_30d, 0) <= 0 then 999.0
    when coalesce(s.stock_actual_base, 0) <= 0 then 0.0
    else round((coalesce(s.stock_actual_base, 0) / (v30.unidades_vendidas_30d / 30.0))::numeric, 1)
  end as dias_autonomia,
  greatest(
    p.punto_pedido,
    p.stock_minimo + round((coalesce(v30.unidades_vendidas_30d, 0) / 30.0) * p.lead_time_dias, 3)
  ) as punto_pedido_efectivo,
  greatest(
    round(
      greatest(p.stock_minimo * 2, p.stock_minimo + coalesce(v30.unidades_vendidas_30d, 0), 5.000) - coalesce(s.stock_actual_base, 0),
      3
    ),
    1.000
  ) as cantidad_sugerida,
  pp.proveedor_id,
  coalesce(prov.nombre_fantasia, prov.razon_social) as proveedor_nombre,
  coalesce(pp.costo_proveedor, p.costo_base) as costo_compra_estimado,
  case
    when coalesce(s.stock_actual_base, 0) <= 0 then 'quiebre'
    when coalesce(s.stock_actual_base, 0) <= p.stock_minimo then 'critico'
    when coalesce(s.stock_actual_base, 0) <= greatest(
      p.punto_pedido,
      p.stock_minimo + round((coalesce(v30.unidades_vendidas_30d, 0) / 30.0) * p.lead_time_dias, 3)
    ) then 'preventivo'
    else 'normal'
  end as nivel_urgencia
from producto p
left join v_stock_actual s on s.producto_id = p.id and s.negocio_id = p.negocio_id
left join rubro r on r.id = p.rubro_id and r.negocio_id = p.negocio_id
left join ventas_ultimos_30d v30 on v30.producto_id = p.id and v30.negocio_id = p.negocio_id
left join proveedor_habitual pp on pp.producto_id = p.id and pp.negocio_id = p.negocio_id
left join proveedor prov on prov.id = pp.proveedor_id and prov.negocio_id = p.negocio_id
where p.activo = true;

-- 3. Concesión de privilegios a app_user
grant select on v_articulos_reabastecimiento to app_user;

commit;
