import { type ReactElement } from 'react';
import { formatearPesos } from './App.js';

export interface InicioDashboardProps {
  turnoId: string | null;
  operadorActivo: { id: string; nombre: string; rol: string };
  nombreCaja: string;
  efectivoEsperado: string;
  efectivoInicial: string;
  entradasEfectivo: string;
  salidasEfectivo: string;
  ventasPorMedio: Array<{ medioPago: string; rubro: string; total: string }>;
  ultimoArqueoCerrado: {
    efectivoEsperado: string;
    efectivoContado: string | null;
    diferencia: string | null;
  } | null;
  colaPendienteCount: number;
  modoSinConexion: boolean;
  onNavegar: (
    pestana:
      | 'inicio'
      | 'venta'
      | 'egreso'
      | 'arqueo'
      | 'reportes'
      | 'configuracion'
      | 'catalogo'
      | 'inventario'
      | 'clientes'
      | 'compras'
      | 'tesoreria'
      | 'facturacion'
      | 'contabilidad'
      | 'presupuestos'
      | 'auditoria',
  ) => void;
}

export function InicioDashboard({
  turnoId,
  operadorActivo,
  nombreCaja,
  efectivoEsperado,
  efectivoInicial,
  entradasEfectivo,
  salidasEfectivo,
  ventasPorMedio,
  ultimoArqueoCerrado,
  colaPendienteCount,
  modoSinConexion,
  onNavegar,
}: InicioDashboardProps): ReactElement {
  const totalVendidoTurno = ventasPorMedio.reduce(
    (acc, v) => acc + parseFloat(v.total || '0'),
    0,
  );

  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* 1. Banner de Bienvenida y Estado del Turno */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-lg border border-slate-700">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Sistema de Gestión Integral Ferretería & Corralón
            </div>
            <h1 className="mt-2 text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              ¡Hola, {operadorActivo.nombre}!
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-300 capitalize">
              {fechaHoy} · Rol: <strong className="text-white">{operadorActivo.rol}</strong>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {turnoId ? (
              <div className="rounded-xl bg-emerald-950/80 border border-emerald-500/40 p-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Turno Abierto ({nombreCaja})
                  </span>
                </div>
                <div className="mt-1 text-xl font-black text-white">
                  {formatearPesos(efectivoEsperado)}
                </div>
                <div className="text-[11px] text-emerald-200/80">Efectivo actual en cajón</div>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-950/80 border border-amber-500/40 p-3.5 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    Caja Cerrada
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { onNavegar('venta'); }}
                  className="mt-2 inline-flex items-center justify-center rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 shadow hover:bg-amber-400 transition"
                >
                  Abrir Turno de Caja 🔓
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Tarjetas de Resumen Financiero en Vivo */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Efectivo Inicial</span>
            <span className="text-lg">💵</span>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900">
            {formatearPesos(efectivoInicial)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Fondo de apertura</div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Ventas del Turno</span>
            <span className="text-lg">📈</span>
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-600">
            {formatearPesos(totalVendidoTurno.toFixed(2))}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Total facturado (Efvo: {formatearPesos(entradasEfectivo)})
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Egresos / Gastos</span>
            <span className="text-lg">💸</span>
          </div>
          <div className="mt-2 text-xl font-bold text-rose-600">
            {formatearPesos(salidasEfectivo)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Pagos y salidas del cajón</div>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-emerald-800 to-teal-900 p-4 text-white shadow-sm">
          <div className="flex items-center justify-between text-xs text-emerald-200 font-medium">
            <span>Efectivo en Cajón</span>
            <span className="text-lg">🗄️</span>
          </div>
          <div className="mt-2 text-2xl font-black text-white">
            {formatearPesos(efectivoEsperado)}
          </div>
          <div className="mt-1 text-[11px] text-emerald-200/90">Saldo esperado para arqueo</div>
        </div>
      </section>

      {/* 3. Accesos Rápidos de Operación Táctica */}
      <div>
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
          Accesos Rápidos de Mostrador
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => { onNavegar('venta'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-500 hover:bg-emerald-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              🛒
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Venta en Mostrador</div>
            <div className="text-xs text-slate-500 mt-0.5">Cobro ágil con código o teclado</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('presupuestos'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-sky-500 hover:bg-sky-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              📝
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Presupuestos</div>
            <div className="text-xs text-slate-500 mt-0.5">Cotizar y transferir a venta</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('catalogo'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-500 hover:bg-amber-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              📦
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Artículos y Stock</div>
            <div className="text-xs text-slate-500 mt-0.5">Consultar precios y cantidades</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('egreso'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-rose-500 hover:bg-rose-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              💸
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Egresos de Caja</div>
            <div className="text-xs text-slate-500 mt-0.5">Gastos varios y retiros</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('clientes'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-500 hover:bg-indigo-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              👥
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Clientes y Cta. Cte.</div>
            <div className="text-xs text-slate-500 mt-0.5">Cobranzas y saldos de clientes</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('compras'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-orange-500 hover:bg-orange-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              🚚
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Proveedores & Compras</div>
            <div className="text-xs text-slate-500 mt-0.5">Órdenes, recepción y pagos</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('facturacion'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-500 hover:bg-blue-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              🧾
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Facturación ARCA</div>
            <div className="text-xs text-slate-500 mt-0.5">Facturas A, B y Libro IVA</div>
          </button>

          <button
            type="button"
            onClick={() => { onNavegar('arqueo'); }}
            className="group flex flex-col items-start p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-500 hover:bg-purple-50/30 transition text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl group-hover:scale-110 transition">
              🔒
            </div>
            <div className="mt-3 font-bold text-slate-900 text-sm">Arqueo y Cierre</div>
            <div className="text-xs text-slate-500 mt-0.5">Conteo ciego y cierre de turno</div>
          </button>
        </div>
      </div>

      {/* 4. Paneles de Estado Operativo */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Desglose de Ventas por Medio */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Ventas del Turno Actual por Medio
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              Total: {formatearPesos(totalVendidoTurno.toFixed(2))}
            </span>
          </div>

          {ventasPorMedio.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No se han registrado ventas en el turno actual todavía.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-xs">
              {ventasPorMedio.map((v, idx) => (
                <li
                  key={`${v.medioPago}-${v.rubro}-${idx}`}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-medium text-slate-700">{v.medioPago}</span>
                    <span className="text-slate-400">· {v.rubro}</span>
                  </div>
                  <span className="font-bold text-slate-900">{formatearPesos(v.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Estado del Sistema y Último Arqueo */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100">
              Estado de la Operación
            </h3>

            <div className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-600">Conectividad:</span>
                <span className={`font-bold ${modoSinConexion ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {modoSinConexion ? 'Sin Conexión (Trabajo Local)' : 'En Línea (Sincronizado)'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-600">Cola local de ventas offline:</span>
                <span className="font-bold text-slate-900">
                  {colaPendienteCount} operaciones
                </span>
              </div>

              {ultimoArqueoCerrado && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950">
                  <div className="font-bold text-xs">Último turno cerrado con arqueo:</div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-emerald-800">
                    <div>Esperado: <strong>{formatearPesos(ultimoArqueoCerrado.efectivoEsperado)}</strong></div>
                    <div>Contado: <strong>{formatearPesos(ultimoArqueoCerrado.efectivoContado ?? '0.00')}</strong></div>
                    <div className="col-span-2">Diferencia: <strong>{formatearPesos(ultimoArqueoCerrado.diferencia ?? '0.00')}</strong></div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => { onNavegar('reportes'); }}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800"
            >
              Ver Reportes Históricos →
            </button>
            <button
              type="button"
              onClick={() => { onNavegar('configuracion'); }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Configuración
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
