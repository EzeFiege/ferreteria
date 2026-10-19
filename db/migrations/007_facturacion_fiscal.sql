-- 007_facturacion_fiscal.sql
-- Fase 6: Facturación Fiscal, Comprobantes Electrónicos A, B, C con ARCA / AFIP, CAE, QR fiscal y contingencia

-- 1. Puntos de Venta (AFIP / ARCA)
create table if not exists punto_venta (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  numero integer not null check (numero between 1 and 99998),
  nombre text not null default 'Punto de Venta Principal',
  tipo text not null default 'electronico_arca' check (tipo in ('electronico_arca', 'manual_contingencia')),
  habilitado boolean not null default true,
  cuit_emisor text,
  inicio_actividades date,
  iibb text,
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  unique (negocio_id, numero)
);

-- RLS para punto_venta
alter table punto_venta enable row level security;

drop policy if exists punto_venta_tenant_isolation on punto_venta;
create policy punto_venta_tenant_isolation on punto_venta
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update on punto_venta to app_user;

-- 2. Tabla Inmutable de Comprobantes Fiscales (Facturas A, B, C, Notas de Crédito)
create table if not exists comprobante_fiscal (
  id uuid not null default gen_random_uuid(),
  negocio_id uuid not null references negocio(id) on delete cascade,
  punto_venta_id uuid not null,
  numero_punto_venta integer not null check (numero_punto_venta between 1 and 99998),
  tipo_comprobante text not null check (
    tipo_comprobante in (
      'factura_a', 'nota_credito_a', 'nota_debito_a',
      'factura_b', 'nota_credito_b', 'nota_debito_b',
      'factura_c', 'nota_credito_c', 'nota_debito_c'
    )
  ),
  codigo_afip integer not null, -- 1: Factura A, 6: Factura B, 11: Factura C, etc.
  numero_comprobante integer not null check (numero_comprobante > 0),
  fecha_emision date not null default current_date,
  venta_id uuid references venta(id) on delete set null,
  cliente_id uuid references cliente(id) on delete set null,
  cuit_cliente text,
  tipo_documento_afip integer not null default 99, -- 80: CUIT, 96: DNI, 99: Sin identificar/Consumidor final
  razon_social_cliente text not null,
  condicion_iva_cliente text not null default 'consumidor_final',
  domicilio_cliente text,
  
  -- Desglose impositivo exacto (numeric 14,2)
  subtotal_neto_gravado numeric(14,2) not null default 0.00,
  subtotal_iva_21 numeric(14,2) not null default 0.00,
  subtotal_iva_105 numeric(14,2) not null default 0.00,
  subtotal_iva_27 numeric(14,2) not null default 0.00,
  subtotal_exento numeric(14,2) not null default 0.00,
  subtotal_no_gravado numeric(14,2) not null default 0.00,
  total numeric(14,2) not null check (total >= 0),

  -- Datos de autorización ARCA / AFIP
  estado text not null default 'autorizado' check (estado in ('autorizado', 'contingencia_offline', 'rechazado', 'anulado')),
  cae text, -- 14 dígitos numéricos obligatorios cuando estado = 'autorizado'
  vencimiento_cae date,
  codigo_qr_arca text, -- URL de verificación oficial ARCA RG 4291/4892
  resultado_afip text, -- 'A': Aprobado, 'R': Rechazado, 'P': Pendiente contingencia
  motivo_observacion_afip text,

  creado_por uuid not null references usuario(id),
  creado_en timestamptz not null default now(),
  primary key (id, negocio_id),
  unique (negocio_id, numero_punto_venta, tipo_comprobante, numero_comprobante),
  foreign key (punto_venta_id, negocio_id) references punto_venta(id, negocio_id) on delete restrict
);

create index if not exists idx_comprobante_fiscal_negocio_fecha on comprobante_fiscal(negocio_id, fecha_emision);
create index if not exists idx_comprobante_fiscal_venta on comprobante_fiscal(negocio_id, venta_id);
create index if not exists idx_comprobante_fiscal_cae on comprobante_fiscal(negocio_id, cae);

-- RLS para comprobante_fiscal
alter table comprobante_fiscal enable row level security;

drop policy if exists comprobante_fiscal_tenant_isolation on comprobante_fiscal;
create policy comprobante_fiscal_tenant_isolation on comprobante_fiscal
  for all
  using (negocio_id = current_setting('app.negocio_id', true)::uuid);

grant select, insert, update on comprobante_fiscal to app_user;

-- 3. Trigger de Inmutabilidad Fiscal: Comprobantes autorizados con CAE no pueden modificarse ni eliminarse
create or replace function fn_comprobante_fiscal_inmutable()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Violación de regla fiscal: los comprobantes fiscales no pueden eliminarse (id: %)', old.id;
  end if;

  if tg_op = 'UPDATE' then
    -- Permitir únicamente actualizar estado si venía de contingencia_offline a autorizado
    if old.estado = 'contingencia_offline' and new.estado = 'autorizado' then
      return new;
    end if;

    raise exception 'Violación de regla fiscal: los comprobantes fiscales autorizados son inmutables (id: %)', old.id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tg_comprobante_fiscal_inmutable on comprobante_fiscal;
create trigger tg_comprobante_fiscal_inmutable
before update or delete on comprobante_fiscal
for each row execute function fn_comprobante_fiscal_inmutable();
