import type { PoolClient } from 'pg';
import type { OrigenAsiento } from '@ferreteria/shared';

export const PLAN_CUENTAS_BASE = [
  { codigo: '1.1.01', nombre: 'Caja Efectivo', tipo: 'activo', descripcion: 'Dinero en efectivo en cajas' },
  { codigo: '1.1.02', nombre: 'Banco y Cuentas Virtuales', tipo: 'activo', descripcion: 'Saldos bancarios, transferencias y billeteras QR' },
  { codigo: '1.1.03', nombre: 'Valores a Depositar (Cheques)', tipo: 'activo', descripcion: 'Cartera de cheques físicos y eCheqs' },
  { codigo: '1.1.04', nombre: 'Deudores por Ventas (Cta Cte)', tipo: 'activo', descripcion: 'Saldos a cobrar de clientes en cuenta corriente' },
  { codigo: '1.1.05', nombre: 'Mercaderías en Stock', tipo: 'activo', descripcion: 'Inventario valorizado a costo de reposición' },
  { codigo: '2.1.01', nombre: 'Proveedores (Cta Cte)', tipo: 'pasivo', descripcion: 'Obligaciones y compras a pagar a proveedores' },
  { codigo: '2.1.02', nombre: 'IVA Débito Fiscal', tipo: 'pasivo', descripcion: 'IVA facturado en ventas' },
  { codigo: '3.1.01', nombre: 'Capital / Patrimonio Social', tipo: 'patrimonio_neto', descripcion: 'Patrimonio inicial y reservas' },
  { codigo: '3.2.01', nombre: 'Resultado del Ejercicio', tipo: 'patrimonio_neto', descripcion: 'Ganancia o pérdida neta acumulada del período contable' },
  { codigo: '4.1.01', nombre: 'Ventas de Mercadería', tipo: 'ingreso', descripcion: 'Ingresos brutos por ventas de salón y mostrador' },
  { codigo: '4.1.02', nombre: 'Otros Ingresos Operativos', tipo: 'ingreso', descripcion: 'Ingresos financieros o extraordinarios' },
  { codigo: '5.1.01', nombre: 'Costo de Mercaderías Vendidas', tipo: 'egreso', descripcion: 'Costo de adquisición de los productos vendidos' },
  { codigo: '5.1.02', nombre: 'Gastos Generales y Operativos', tipo: 'egreso', descripcion: 'Egresos de caja, servicios, fletes y mantenimiento' },
  { codigo: '5.1.03', nombre: 'Gastos Bancarios y Comisiones', tipo: 'egreso', descripcion: 'Comisiones de tarjetas, posnets e impuestos bancarios' },
] as const;

export interface RenglonAsientoInput {
  cuentaCodigo: string;
  debe: string;
  haber: string;
  descripcion?: string | null | undefined;
}

export interface RegistrarAsientoParams {
  negocioId: string;
  concepto: string;
  origen: OrigenAsiento;
  referenciaId?: string | null | undefined;
  usuarioId?: string | null | undefined;
  fecha?: Date | undefined;
  renglones: RenglonAsientoInput[];
}

/**
 * Asegura la existencia de las cuentas estándar del plan de cuentas en el tenant.
 */
export async function asegurarPlanCuentasBase(
  client: PoolClient,
  negocioId: string,
): Promise<void> {
  for (const c of PLAN_CUENTAS_BASE) {
    await client.query(
      `insert into cuenta_contable (negocio_id, codigo, nombre, tipo, descripcion, activa)
       values ($1, $2, $3, $4, $5, true)
       on conflict (negocio_id, codigo) do nothing`,
      [negocioId, c.codigo, c.nombre, c.tipo, c.descripcion],
    );
  }
}

/**
 * Registra un asiento contable automático con balance estricto de partida doble
 * (Total Debe === Total Haber > 0) y correlatividad atómica vía advisory lock.
 */
export async function registrarAsientoAutomatico(
  client: PoolClient,
  params: RegistrarAsientoParams,
): Promise<string> {
  const { negocioId, concepto, origen, referenciaId, usuarioId, fecha, renglones } = params;

  // 1. Filtrar renglones con importes válidos
  const renglonesValidos = renglones.filter((r) => {
    const d = Math.round(parseFloat(r.debe) * 100);
    const h = Math.round(parseFloat(r.haber) * 100);
    return d > 0 || h > 0;
  });

  if (renglonesValidos.length === 0) {
    throw new Error('El asiento contable no tiene renglones con importes mayores a cero');
  }

  // 2. Validación estricta de partida doble en centavos enteros
  let totalDebeCentavos = 0;
  let totalHaberCentavos = 0;

  for (const r of renglonesValidos) {
    const d = Math.round(parseFloat(r.debe) * 100);
    const h = Math.round(parseFloat(r.haber) * 100);
    if (d < 0 || h < 0) {
      throw new Error('Los importes de debe y haber deben ser no negativos');
    }
    if ((d > 0 && h > 0) || (d === 0 && h === 0)) {
      throw new Error(`Renglón inválido en cuenta ${r.cuentaCodigo}: debe imputar solo al Debe o al Haber`);
    }
    totalDebeCentavos += d;
    totalHaberCentavos += h;
  }

  if (totalDebeCentavos !== totalHaberCentavos) {
    throw new Error(
      `Partida doble desbalanceada en asiento '${concepto}': Total Debe ($ ${(totalDebeCentavos / 100).toFixed(2)}) !== Total Haber ($ ${(totalHaberCentavos / 100).toFixed(2)})`,
    );
  }

  // 3. Asegurar que las cuentas existan
  await asegurarPlanCuentasBase(client, negocioId);

  // 4. Mapear códigos de cuenta a IDs
  const codigosUnicos = Array.from(new Set(renglonesValidos.map((r) => r.cuentaCodigo)));
  const cuentasRes = await client.query<{ id: string; codigo: string }>(
    `select id, codigo from cuenta_contable where negocio_id = $1 and codigo = any($2)`,
    [negocioId, codigosUnicos],
  );

  const mapaCuentas = new Map<string, string>();
  for (const row of cuentasRes.rows) {
    mapaCuentas.set(row.codigo, row.id);
  }

  for (const codigo of codigosUnicos) {
    if (!mapaCuentas.has(codigo)) {
      throw new Error(`Cuenta contable código '${codigo}' no encontrada para el negocio`);
    }
  }

  // 5. Advisory lock para correlatividad sin saltos
  await client.query(`select pg_advisory_xact_lock(hashtext('asiento_contable_' || $1))`, [
    negocioId,
  ]);

  const numRes = await client.query<{ proximo_numero: number }>(
    `select coalesce(max(numero), 0) + 1 as proximo_numero
     from asiento_contable
     where negocio_id = $1`,
    [negocioId],
  );
  const proximoNumero = numRes.rows[0]?.proximo_numero ?? 1;
  const fechaAsiento = fecha ?? new Date();

  // 6. Insertar cabecera del asiento inmutable
  const asientoRes = await client.query<{ id: string }>(
    `insert into asiento_contable (
      negocio_id, numero, fecha, concepto, origen, referencia_id, creado_por
    ) values ($1, $2, $3, $4, $5, $6, $7)
    returning id`,
    [
      negocioId,
      proximoNumero,
      fechaAsiento,
      concepto,
      origen,
      referenciaId ?? null,
      usuarioId ?? null,
    ],
  );
  const asientoId = asientoRes.rows[0]?.id;
  if (!asientoId) {
    throw new Error('No se pudo registrar el asiento contable');
  }

  // 7. Insertar renglones inmutables
  for (const r of renglonesValidos) {
    const cuentaId = mapaCuentas.get(r.cuentaCodigo);
    await client.query(
      `insert into renglon_asiento (
        asiento_id, negocio_id, cuenta_id, debe, haber, descripcion
      ) values ($1, $2, $3, $4, $5, $6)`,
      [
        asientoId,
        negocioId,
        cuentaId,
        r.debe,
        r.haber,
        r.descripcion ?? null,
      ],
    );
  }

  return asientoId;
}
