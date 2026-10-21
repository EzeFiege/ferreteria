import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';
import { exportarACSV } from './utils/exportar-csv.js';

export interface CajaFiltroItem {
  id: string;
  nombre: string;
}

export interface OperadorFiltroItem {
  id: string;
  nombre: string;
  rol: 'dueno' | 'encargado' | 'cajero';
  token: string;
}

interface ReporteDiaData {
  fecha: string;
  cantidadTurnos: number;
  resumenCaja: {
    efectivoInicial: string;
    entradasEfectivo: string;
    salidasEfectivo: string;
    efectivoEsperado: string;
    efectivoContado: string;
    diferenciaArqueo: string;
  };
  totalVentasDia: string;
  totalesPorMedio: Array<{ medioPago: string; total: string }>;
  ventasPorMedioRubro: Array<{
    medioPago: string;
    rubro: string;
    total: string;
  }>;
  totalEgresosDia: string;
  egresosPorCategoria: Array<{
    categoria: string;
    medioPago: string;
    total: string;
  }>;
}

interface TurnoHistorialItem {
  turnoId: string;
  cajaId: string;
  cajaNombre: string;
  cajeroId: string;
  cajeroNombre: string;
  cerradoPorNombre: string | null;
  abreEn: string;
  cierraEn: string | null;
  efectivoInicial: string;
  entradasEfectivo: string;
  salidasEfectivo: string;
  efectivoEsperado: string;
  efectivoContado: string | null;
  diferencia: string | null;
  notas: string | null;
  ventasPorMedioRubro: Array<{
    medioPago: string;
    rubro: string;
    total: string;
  }>;
}

interface DiferenciaPorCajeroItem {
  cajeroId: string;
  cajeroNombre: string;
  cantidadTurnos: number;
  turnosCerrados: number;
  diferenciaAcumulada: string;
}

export interface ReportesHistorialProps {
  token: string;
  cajas: CajaFiltroItem[];
  operadores: OperadorFiltroItem[];
  rolActivo: 'dueno' | 'encargado' | 'cajero';
  onSolicitarRolEncargado: () => void;
}

export function ReportesHistorial({
  token,
  cajas,
  operadores,
  rolActivo,
  onSolicitarRolEncargado,
}: ReportesHistorialProps): ReactElement {
  const [fechaDia, setFechaDia] = useState<string>('');
  const [fechaDesde, setFechaDesde] = useState<string>('');
  const [fechaHasta, setFechaHasta] = useState<string>('');
  const [cajaIdFiltro, setCajaIdFiltro] = useState<string>('');
  const [cajeroIdFiltro, setCajeroIdFiltro] = useState<string>('');

  const [reporteDia, setReporteDia] = useState<ReporteDiaData | null>(null);
  const [turnosHistorial, setTurnosHistorial] = useState<TurnoHistorialItem[]>(
    [],
  );
  const [diferenciasCajero, setDiferenciasCajero] = useState<
    DiferenciaPorCajeroItem[]
  >([]);
  const [cargando, setCargando] = useState<boolean>(false);

  const cargarReportes = useCallback(async () => {
    if (rolActivo === 'cajero') {
      return;
    }
    setCargando(true);
    try {
      const paramsDia = new URLSearchParams();
      if (fechaDia) {
        paramsDia.set('fecha', fechaDia);
      }
      if (cajaIdFiltro) {
        paramsDia.set('cajaId', cajaIdFiltro);
      }

      const paramsHist = new URLSearchParams();
      if (fechaDesde) {
        paramsHist.set('fechaDesde', fechaDesde);
      }
      if (fechaHasta) {
        paramsHist.set('fechaHasta', fechaHasta);
      }
      if (cajaIdFiltro) {
        paramsHist.set('cajaId', cajaIdFiltro);
      }
      if (cajeroIdFiltro) {
        paramsHist.set('cajeroId', cajeroIdFiltro);
      }

      const [resDia, resHist] = await Promise.all([
        fetch(apiUrl(`/api/reportes/dia?${paramsDia.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl(`/api/reportes/historial-turnos?${paramsHist.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (resDia.ok) {
        const dataDia = (await resDia.json()) as ReporteDiaData;
        setReporteDia(dataDia);
        if (!fechaDia && dataDia.fecha) {
          setFechaDia(dataDia.fecha);
        }
      }

      if (resHist.ok) {
        const dataHist = (await resHist.json()) as {
          turnos: TurnoHistorialItem[];
          diferenciasPorCajero: DiferenciaPorCajeroItem[];
        };
        setTurnosHistorial(dataHist.turnos);
        setDiferenciasCajero(dataHist.diferenciasPorCajero);
      }
    } finally {
      setCargando(false);
    }
  }, [
    cajaIdFiltro,
    cajeroIdFiltro,
    fechaDesde,
    fechaDia,
    fechaHasta,
    rolActivo,
    token,
  ]);

  useEffect(() => {
    void cargarReportes();
  }, [cargarReportes]);

  if (rolActivo === 'cajero') {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900">
          Reportes del Día e Historial de Turnos
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Los reportes generales y el historial de diferencias requieren rol{' '}
          <strong>encargado</strong> o <strong>dueño</strong>.
        </p>
        <button
          type="button"
          data-testid="btn-autorizar-reportes-encargado"
          onClick={() => {
            onSolicitarRolEncargado();
          }}
          className="mt-4 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-xs hover:bg-amber-400"
        >
          Ver como Encargado / Dueño
        </button>
      </div>
    );
  }

  const totalMedio = (nombre: string): string =>
    reporteDia?.totalesPorMedio.find((m) => m.medioPago === nombre)?.total ??
    '0.00';

  const exportarReporteDiaCSV = (): void => {
    if (!reporteDia) return;
    const columnas = ['Fecha', 'Tipo', 'Detalle / Rubro / Categoría', 'Medio de Cobro', 'Total ($)'];
    const filas: (string | number)[][] = [];

    // Ventas por medio y rubro
    for (const v of reporteDia.ventasPorMedioRubro) {
      filas.push([reporteDia.fecha, 'Venta', v.rubro, v.medioPago, v.total]);
    }

    // Egresos por categoría
    for (const eg of reporteDia.egresosPorCategoria) {
      filas.push([reporteDia.fecha, 'Egreso', eg.categoria, eg.medioPago, eg.total]);
    }

    exportarACSV(`reporte_caja_${reporteDia.fecha}`, columnas, filas);
  };

  const exportarHistorialTurnosCSV = (): void => {
    if (turnosHistorial.length === 0) return;
    const columnas = [
      'Turno ID',
      'Caja',
      'Cajero',
      'Apertura',
      'Cierre',
      'Efectivo Inicial ($)',
      'Entradas ($)',
      'Salidas ($)',
      'Efectivo Esperado ($)',
      'Efectivo Contado ($)',
      'Diferencia Arqueo ($)',
      'Notas',
    ];
    const filas: (string | number | null | undefined)[][] = turnosHistorial.map((t: TurnoHistorialItem) => [
      t.turnoId,
      t.cajaNombre,
      t.cajeroNombre,
      t.abreEn ? new Date(t.abreEn).toLocaleString('es-AR') : '',
      t.cierraEn ? new Date(t.cierraEn).toLocaleString('es-AR') : 'Abierto',
      t.efectivoInicial,
      t.entradasEfectivo,
      t.salidasEfectivo,
      t.efectivoEsperado,
      t.efectivoContado ?? '0.00',
      t.diferencia ?? '0.00',
      t.notas ?? '',
    ]);

    exportarACSV(`historial_turnos_${fechaDesde}_al_${fechaHasta}`, columnas, filas);
  };

  return (
    <div className="space-y-6" data-testid="panel-reportes-historial">
      {/* Barra de filtros por fecha, caja y cajero */}
      <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Filtros de Reporte Diario e Historial
            </h2>
            <p className="text-xs text-slate-500">
              Consultá las vistas <code>v_resumen_turno</code> y{' '}
              <code>v_ventas_por_medio_rubro</code> filtrando por fecha, caja y cajero.
            </p>
          </div>
          <button
            type="button"
            data-testid="btn-aplicar-filtros"
            disabled={cargando}
            onClick={() => void cargarReportes()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
          >
            {cargando ? 'Actualizando...' : 'Actualizar reportes'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label
              htmlFor="filtro-fecha-dia"
              className="block text-xs font-semibold text-slate-600"
            >
              Fecha del Día
            </label>
            <input
              id="filtro-fecha-dia"
              data-testid="filtro-fecha-dia"
              type="date"
              value={fechaDia}
              onChange={(e) => {
                setFechaDia(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="filtro-fecha-desde"
              className="block text-xs font-semibold text-slate-600"
            >
              Historial Desde
            </label>
            <input
              id="filtro-fecha-desde"
              data-testid="filtro-fecha-desde"
              type="date"
              value={fechaDesde}
              onChange={(e) => {
                setFechaDesde(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="filtro-fecha-hasta"
              className="block text-xs font-semibold text-slate-600"
            >
              Historial Hasta
            </label>
            <input
              id="filtro-fecha-hasta"
              data-testid="filtro-fecha-hasta"
              type="date"
              value={fechaHasta}
              onChange={(e) => {
                setFechaHasta(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="filtro-caja"
              className="block text-xs font-semibold text-slate-600"
            >
              Caja
            </label>
            <select
              id="filtro-caja"
              data-testid="filtro-caja"
              value={cajaIdFiltro}
              onChange={(e) => {
                setCajaIdFiltro(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            >
              <option value="">Todas las cajas</option>
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filtro-cajero"
              className="block text-xs font-semibold text-slate-600"
            >
              Cajero
            </label>
            <select
              id="filtro-cajero"
              data-testid="filtro-cajero"
              value={cajeroIdFiltro}
              onChange={(e) => {
                setCajeroIdFiltro(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            >
              <option value="">Todos los cajeros</option>
              {operadores.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Reporte del Día (Totales estilo planilla Excel) */}
      {reporteDia && (
        <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Reporte del Día ({reporteDia.fecha}) · {reporteDia.cantidadTurnos}{' '}
              turno(s)
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportarReporteDiaCSV}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Exportar Reporte a Excel 📊
              </button>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">
                Total Ventas del Día:{' '}
                <span data-testid="reporte-dia-total-ventas">
                  {formatearPesos(reporteDia.totalVentasDia)}
                </span>
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-200">
              <div className="text-xs font-semibold text-emerald-800">
                Ventas Efectivo
              </div>
              <div
                data-testid="reporte-dia-efectivo"
                className="mt-1 text-lg font-black text-emerald-950"
              >
                {formatearPesos(totalMedio('Efectivo'))}
              </div>
            </div>

            <div className="rounded-xl bg-blue-50 p-3 border border-blue-200">
              <div className="text-xs font-semibold text-blue-800">
                Ventas Tarjeta
              </div>
              <div
                data-testid="reporte-dia-tarjeta"
                className="mt-1 text-lg font-black text-blue-950"
              >
                {formatearPesos(totalMedio('Tarjeta'))}
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50 p-3 border border-indigo-200">
              <div className="text-xs font-semibold text-indigo-800">
                Transferencia/QR
              </div>
              <div
                data-testid="reporte-dia-transferencia"
                className="mt-1 text-lg font-black text-indigo-950"
              >
                {formatearPesos(totalMedio('Transferencia/QR'))}
              </div>
            </div>

            <div className="rounded-xl bg-rose-50 p-3 border border-rose-200">
              <div className="text-xs font-semibold text-rose-800">
                Total Egresos
              </div>
              <div
                data-testid="reporte-dia-egresos"
                className="mt-1 text-lg font-black text-rose-950"
              >
                {formatearPesos(reporteDia.totalEgresosDia)}
              </div>
            </div>

            <div className="rounded-xl bg-slate-100 p-3 border border-slate-200">
              <div className="text-xs font-semibold text-slate-700">
                Efectivo Esperado
              </div>
              <div
                data-testid="reporte-dia-esperado"
                className="mt-1 text-lg font-black text-slate-900"
              >
                {formatearPesos(reporteDia.resumenCaja.efectivoEsperado)}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 p-3 border border-amber-200">
              <div className="text-xs font-semibold text-amber-800">
                Diferencia Arqueo
              </div>
              <div
                data-testid="reporte-dia-diferencia"
                className="mt-1 text-lg font-black text-amber-950"
              >
                {formatearPesos(reporteDia.resumenCaja.diferenciaArqueo)}
              </div>
            </div>
          </div>

          {/* Tablas de Ventas por Medio y Rubro + Egresos por Categoría */}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Ventas por medio de cobro y rubro (v_ventas_por_medio_rubro)
              </h4>
              {reporteDia.ventasPorMedioRubro.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Sin ventas registradas en la fecha seleccionada.
                </p>
              ) : (
                <table className="mt-2 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-1.5">Medio de Pago</th>
                      <th className="py-1.5">Rubro</th>
                      <th className="py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reporteDia.ventasPorMedioRubro.map((fila, i) => (
                      <tr key={`${fila.medioPago}-${fila.rubro}-${i}`}>
                        <td className="py-1.5 font-semibold text-slate-800">
                          {fila.medioPago}
                        </td>
                        <td className="py-1.5 text-slate-600">{fila.rubro}</td>
                        <td className="py-1.5 text-right font-bold text-slate-900">
                          {formatearPesos(fila.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Egresos del día por categoría
              </h4>
              {reporteDia.egresosPorCategoria.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Sin egresos registrados en la fecha seleccionada.
                </p>
              ) : (
                <table className="mt-2 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-1.5">Categoría</th>
                      <th className="py-1.5">Medio</th>
                      <th className="py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reporteDia.egresosPorCategoria.map((eg, i) => (
                      <tr key={`${eg.categoria}-${eg.medioPago}-${i}`}>
                        <td className="py-1.5 font-semibold text-slate-800">
                          {eg.categoria}
                        </td>
                        <td className="py-1.5 text-slate-600">{eg.medioPago}</td>
                        <td className="py-1.5 text-right font-bold text-rose-700">
                          {formatearPesos(eg.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Diferencias de arqueo acumuladas por cajero */}
      <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <h3 className="text-base font-bold text-slate-900">
          Diferencias de Arqueo por Cajero
        </h3>
        {diferenciasCajero.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            No hay turnos que coincidan con los filtros seleccionados.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {diferenciasCajero.map((c) => (
              <div
                key={c.cajeroId}
                data-testid={`diferencia-cajero-${c.cajeroNombre}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {c.cajeroNombre}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.turnosCerrados} de {c.cantidadTurnos} turno(s) cerrados
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Dif. acumulada</div>
                  <div className="text-base font-black text-slate-900">
                    {formatearPesos(c.diferenciaAcumulada)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Historial de Turnos (v_resumen_turno) */}
      <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900">
            Historial de Turnos (v_resumen_turno)
          </h3>
          {turnosHistorial.length > 0 && (
            <button
              type="button"
              onClick={exportarHistorialTurnosCSV}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Exportar Turnos a Excel 📊
            </button>
          )}
        </div>
        {turnosHistorial.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Sin turnos para los filtros aplicados.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table
              data-testid="tabla-historial-turnos"
              className="w-full text-left text-sm"
            >
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Caja / Cajero</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3 text-right">Inicial</th>
                  <th className="py-2 pr-3 text-right">Entradas Ef.</th>
                  <th className="py-2 pr-3 text-right">Salidas Ef.</th>
                  <th className="py-2 pr-3 text-right">Esperado</th>
                  <th className="py-2 pr-3 text-right">Contado</th>
                  <th className="py-2 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {turnosHistorial.map((t) => (
                  <tr key={t.turnoId} data-testid={`fila-turno-${t.turnoId}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-bold text-slate-900">
                        {t.cajaNombre}
                      </div>
                      <div className="text-xs text-slate-500">
                        Abrió: {t.cajeroNombre}
                        {t.cerradoPorNombre
                          ? ` · Cerró: ${t.cerradoPorNombre}`
                          : ''}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          t.cierraEn
                            ? 'bg-slate-200 text-slate-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {t.cierraEn ? 'Cerrado' : 'Abierto'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium">
                      {formatearPesos(t.efectivoInicial)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium text-emerald-700">
                      {formatearPesos(t.entradasEfectivo)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium text-rose-700">
                      {formatearPesos(t.salidasEfectivo)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold text-slate-900">
                      {formatearPesos(t.efectivoEsperado)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold text-blue-900">
                      {t.efectivoContado !== null
                        ? formatearPesos(t.efectivoContado)
                        : '—'}
                    </td>
                    <td className="py-2.5 text-right font-black text-amber-900">
                      {t.diferencia !== null
                        ? formatearPesos(t.diferencia)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
