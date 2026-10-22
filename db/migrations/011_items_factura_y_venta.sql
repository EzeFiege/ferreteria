-- 011_items_factura_y_venta.sql
-- Etapa 12: Detalle de Ítems en Comprobantes Fiscales Electrónicos ARCA / AFIP

create table if not exists item_comprobante_fiscal (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  comprobante_id uuid not null,
  producto_id uuid,
  codigo text,
  descripcion text not null,
  unidad text not null default 'unidad',
  cantidad numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  alicuota_iva text not null default '21',
  subtotal numeric(14,2) not null check (subtotal >= 0),
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  foreign key (comprobante_id, negocio_id) references comprobante_fiscal(id, negocio_id) on delete cascade
);

-- RLS para item_comprobante_fiscal
alter table item_comprobante_fiscal enable row level security;

drop policy if exists item_comprobante_fiscal_tenant_isolation on item_comprobante_fiscal;
create policy item_comprobante_fiscal_tenant_isolation on item_comprobante_fiscal
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert on item_comprobante_fiscal to app_user;

create index if not exists idx_item_comprobante_fiscal_comprobante
  on item_comprobante_fiscal(negocio_id, comprobante_id);

create index if not exists idx_item_comprobante_fiscal_producto
  on item_comprobante_fiscal(negocio_id, producto_id);
