import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import { formatearPesos } from './App.js';
import { apiUrl } from './api-url.js';
import { exportarACSV } from './utils/exportar-csv.js';
import type {
  AsientoContableDetalle,
  CuentaContableItem,
  EjercicioContableItem,
  ItemSumasYSaldos,
  OrigenAsiento,
  RolUsuario,
  TipoCuentaContable,
} from '@ferreteria/shared';

export interface ContabilidadProps {
  token: string;
  rolUsuario: RolUsuario;
}

interface RenglonFormState {
  cuentaId: string;
  debe: string;
  haber: string;
  descripcion: string;
}

export function Contabilidad({
  token,
  rolUsuario,
}: ContabilidadProps): ReactElement {
  const [subpestana, setSubpestana] = useState<'diario' | 'sumas_saldos' | 'plan_cuentas' | 'ejercicios'>('diario');
  const [cuentas, setCuentas] = useState<CuentaContableItem[]>([]);
  const [asientos, setAsientos] = useState<AsientoContableDetalle[]>([]);
  const [sumasSaldos, setSumasSaldos] = useState<ItemSumasYSaldos[]>([]);
  const [ejercicios, setEjercicios] = useState<EjercicioContableItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Filtros Libro Diario
  const [filtroOrigen, setFiltroOrigen] = useState<string>('todos');
  const [filtroFechaDesde, setFiltroFechaDesde] = useState<string>('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState<string>('');

  // Modal Asiento Manual
  const [modalAsiento, setModalAsiento] = useState<boolean>(false);
  const [conceptoAsiento, setConceptoAsiento] = useState<string>('');
  const [origenAsiento, setOrigenAsiento] = useState<OrigenAsiento>('manual');
  const [renglones, setRenglones] = useState<RenglonFormState[]>([
    { cuentaId: '', debe: '', haber: '', descripcion: '' },
    { cuentaId: '', debe: '', haber: '', descripcion: '' },
  ]);
  const [guardandoAsiento, setGuardandoAsiento] = useState<boolean>(false);

  // Modal Nueva Cuenta
  const [modalCuenta, setModalCuenta] = useState<boolean>(false);
  const [nuevoCodigo, setNuevoCodigo] = useState<string>('');
  const [nuevoNombre, setNuevoNombre] = useState<string>('');
  const [nuevoTipo, setNuevoTipo] = useState<TipoCuentaContable>('egreso');
  const [nuevaDescripcion, setNuevaDescripcion] = useState<string>('');
  const [guardandoCuenta, setGuardandoCuenta] = useState<boolean>(false);

  // Modal Nuevo Ejercicio
  const [modalEjercicio, setModalEjercicio] = useState<boolean>(false);
  const [nombreEjercicio, setNombreEjercicio] = useState<string>('');
  const [fechaInicioEjercicio, setFechaInicioEjercicio] = useState<string>('');
  const [fechaFinEjercicio, setFechaFinEjercicio] = useState<string>('');
  const [guardandoEjercicio, setGuardandoEjercicio] = useState<boolean>(false);

  // Cierre de Ejercicio
  const [ejercicioACerrar, setEjercicioACerrar] = useState<EjercicioContableItem | null>(null);
  const [cerrandoEjercicio, setCerrandoEjercicio] = useState<boolean>(false);

  const puedeGestionar = rolUsuario === 'dueno' || rolUsuario === 'encargado';

  // 1. Cargar plan de cuentas
  const cargarCuentas = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/contabilidad/cuentas'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as CuentaContableItem[];
        setCuentas(data);
      }
    } catch {
      // Ignorar error transitorio
    }
  }, [token]);

  // 2. Cargar Libro Diario
  const cargarLibroDiario = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtroOrigen !== 'todos') {
        params.set('origen', filtroOrigen);
      }
      if (filtroFechaDesde) {
        params.set('fechaDesde', filtroFechaDesde);
      }
      if (filtroFechaHasta) {
        params.set('fechaHasta', filtroFechaHasta);
      }

      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(apiUrl(`/contabilidad/libro-diario${queryStr}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as AsientoContableDetalle[];
        setAsientos(data);
      }
    } catch {
      setAviso('Error de red al consultar el libro diario');
    } finally {
      setCargando(false);
    }
  }, [token, filtroOrigen, filtroFechaDesde, filtroFechaHasta]);

  // 3. Cargar Sumas y Saldos
  const cargarSumasSaldos = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(apiUrl('/contabilidad/sumas-y-saldos'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ItemSumasYSaldos[];
        setSumasSaldos(data);
      }
    } catch {
      setAviso('Error de red al consultar sumas y saldos');
    } finally {
      setCargando(false);
    }
  }, [token]);

  // 4. Cargar Ejercicios Contables
  const cargarEjercicios = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(apiUrl('/contabilidad/ejercicios'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as EjercicioContableItem[];
        setEjercicios(data);
      }
    } catch {
      setAviso('Error de red al consultar ejercicios contables');
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarCuentas();
    if (subpestana === 'diario') {
      void cargarLibroDiario();
    } else if (subpestana === 'sumas_saldos') {
      void cargarSumasSaldos();
    } else if (subpestana === 'ejercicios') {
      void cargarEjercicios();
    }
  }, [subpestana, cargarCuentas, cargarLibroDiario, cargarSumasSaldos, cargarEjercicios]);

  // Cálculo de totales en vivo para el modal de Asiento
  const totalDebeModalCentavos = renglones.reduce((acc, r) => {
    const val = parseFloat(r.debe) || 0;
    return acc + Math.round(val * 100);
  }, 0);

  const totalHaberModalCentavos = renglones.reduce((acc, r) => {
    const val = parseFloat(r.haber) || 0;
    return acc + Math.round(val * 100);
  }, 0);

  const diferenciaModalCentavos = Math.abs(totalDebeModalCentavos - totalHaberModalCentavos);
  const asientoModalBalanceado =
    totalDebeModalCentavos > 0 &&
    totalDebeModalCentavos === totalHaberModalCentavos &&
    renglones.every((r) => r.cuentaId !== '');

  // Funciones para manipular renglones del modal
  const agregarRenglon = (): void => {
    setRenglones([...renglones, { cuentaId: '', debe: '', haber: '', descripcion: '' }]);
  };

  const quitarRenglon = (idx: number): void => {
    if (renglones.length <= 2) return;
    setRenglones(renglones.filter((_, i) => i !== idx));
  };

  const actualizarRenglon = (
    idx: number,
    campo: keyof RenglonFormState,
    valor: string,
  ): void => {
    setRenglones((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (campo === 'debe' && valor !== '') {
          return { ...r, debe: valor, haber: '' };
        }
        if (campo === 'haber' && valor !== '') {
          return { ...r, haber: valor, debe: '' };
        }
        return { ...r, [campo]: valor };
      }),
    );
  };

  // Enviar nuevo asiento manual
  const handleGuardarAsiento = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!asientoModalBalanceado) return;

    setGuardandoAsiento(true);
    setAviso(null);
    try {
      const payload = {
        concepto: conceptoAsiento.trim(),
        origen: origenAsiento,
        renglones: renglones.map((r) => ({
          cuentaId: r.cuentaId,
          debe: (parseFloat(r.debe) || 0).toFixed(2),
          haber: (parseFloat(r.haber) || 0).toFixed(2),
          descripcion: r.descripcion.trim() || undefined,
        })),
      };

      const res = await fetch(apiUrl('/contabilidad/asientos'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        setAviso(errorData.error ?? 'Error al registrar el asiento contable');
        return;
      }

      setModalAsiento(false);
      setConceptoAsiento('');
      setRenglones([
        { cuentaId: '', debe: '', haber: '', descripcion: '' },
        { cuentaId: '', debe: '', haber: '', descripcion: '' },
      ]);
      setAviso('Asiento contable registrado con éxito en el libro diario');
      void cargarLibroDiario();
      void cargarSumasSaldos();
    } catch {
      setAviso('Error de red al guardar el asiento');
    } finally {
      setGuardandoAsiento(false);
    }
  };

  // Enviar nueva cuenta contable
  const handleGuardarCuenta = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!nuevoCodigo.trim() || !nuevoNombre.trim()) return;

    setGuardandoCuenta(true);
    setAviso(null);
    try {
      const payload = {
        codigo: nuevoCodigo.trim(),
        nombre: nuevoNombre.trim(),
        tipo: nuevoTipo,
        descripcion: nuevaDescripcion.trim() || undefined,
        activa: true,
      };

      const res = await fetch(apiUrl('/contabilidad/cuentas'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        setAviso(errorData.error ?? 'Error al crear la cuenta contable');
        return;
      }

      setModalCuenta(false);
      setNuevoCodigo('');
      setNuevoNombre('');
      setNuevaDescripcion('');
      setAviso('Cuenta contable agregada al plan de cuentas');
      void cargarCuentas();
    } catch {
      setAviso('Error de red al crear la cuenta');
    } finally {
      setGuardandoCuenta(false);
    }
  };

  // Totales consolidados de Sumas y Saldos
  const totalDebitosCentavos = sumasSaldos.reduce((acc, c) => acc + Math.round(parseFloat(c.totalDebe) * 100), 0);
  const totalCreditosCentavos = sumasSaldos.reduce((acc, c) => acc + Math.round(parseFloat(c.totalHaber) * 100), 0);
  const totalSaldosDeudoresCentavos = sumasSaldos.reduce((acc, c) => acc + Math.round(parseFloat(c.saldoDeudor) * 100), 0);
  const totalSaldosAcreedoresCentavos = sumasSaldos.reduce((acc, c) => acc + Math.round(parseFloat(c.saldoAcreedor) * 100), 0);

  const balanceSumasCuadrado = totalDebitosCentavos === totalCreditosCentavos;
  const balanceSaldosCuadrado = totalSaldosDeudoresCentavos === totalSaldosAcreedoresCentavos;

  const exportarLibroDiarioCSV = (): void => {
    if (asientos.length === 0) return;
    const columnas = [
      'Nº Asiento',
      'Fecha',
      'Concepto',
      'Origen',
      'Código Cuenta',
      'Cuenta Contable',
      'Tipo Cuenta',
      'Detalle Renglón',
      'Debe ($)',
      'Haber ($)',
    ];
    const filas: (string | number | null | undefined)[][] = [];

    for (const a of asientos) {
      for (const r of a.renglones) {
        filas.push([
          a.numero,
          new Date(a.fecha).toLocaleString('es-AR'),
          a.concepto,
          a.origen,
          r.cuentaCodigo,
          r.cuentaNombre,
          r.cuentaTipo,
          r.descripcion ?? '',
          r.debe,
          r.haber,
        ]);
      }
    }

    const hoy = new Date().toISOString().split('T')[0] ?? '';
    exportarACSV(`libro_diario_${hoy}`, columnas, filas);
  };

  const exportarSumasSaldosCSV = (): void => {
    if (sumasSaldos.length === 0) return;
    const columnas = [
      'Código',
      'Cuenta Contable',
      'Tipo Cuenta',
      'Total Débitos / Debe ($)',
      'Total Créditos / Haber ($)',
      'Saldo Deudor ($)',
      'Saldo Acreedor ($)',
    ];
    const filas: (string | number)[][] = sumasSaldos.map((s) => [
      s.cuentaCodigo,
      s.cuentaNombre,
      s.cuentaTipo,
      s.totalDebe,
      s.totalHaber,
      s.saldoDeudor,
      s.saldoAcreedor,
    ]);

    const hoy = new Date().toISOString().split('T')[0] ?? '';
    exportarACSV(`balance_sumas_y_saldos_${hoy}`, columnas, filas);
  };

  const handleGuardarEjercicio = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!nombreEjercicio.trim() || !fechaInicioEjercicio || !fechaFinEjercicio) {
      setAviso('Completá todos los campos del ejercicio contable');
      return;
    }
    if (fechaFinEjercicio < fechaInicioEjercicio) {
      setAviso('La fecha de fin no puede ser anterior a la fecha de inicio');
      return;
    }

    setGuardandoEjercicio(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/contabilidad/ejercicios'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: nombreEjercicio.trim(),
          fechaInicio: fechaInicioEjercicio,
          fechaFin: fechaFinEjercicio,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Error al abrir ejercicio contable');
      }

      setModalEjercicio(false);
      setNombreEjercicio('');
      setFechaInicioEjercicio('');
      setFechaFinEjercicio('');
      setAviso('Ejercicio contable abierto con éxito');
      void cargarEjercicios();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error desconocido al crear ejercicio');
    } finally {
      setGuardandoEjercicio(false);
    }
  };

  const handleCerrarEjercicioConfirmado = async (): Promise<void> => {
    if (!ejercicioACerrar) return;
    setCerrandoEjercicio(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl(`/contabilidad/ejercicios/${ejercicioACerrar.id}/cerrar`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Error al formalizar el cierre de ejercicio');
      }

      const data = (await res.json()) as { resultadoNeto: string };
      setEjercicioACerrar(null);
      setAviso(`Ejercicio #${ejercicioACerrar.numero} cerrado formalmente. Resultado neto refundido: $ ${data.resultadoNeto}`);
      void cargarEjercicios();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error desconocido al cerrar ejercicio');
    } finally {
      setCerrandoEjercicio(false);
    }
  };

  return (
    <section className="space-y-6">
      {/* Header y pestañas */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">
              Contabilidad y Partida Doble
            </h2>
            <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-semibold text-emerald-800">
              Libro Diario Inmutable
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Registro cronológico inmutable de asientos contables con partida doble estricta, balance de sumas y saldos, plan de cuentas y cierres de ejercicio.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {puedeGestionar && (
            <>
              <button
                type="button"
                onClick={() => {
                  setModalEjercicio(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <span>+</span>
                <span>Nuevo Ejercicio</span>
              </button>
              <button
                type="button"
                data-testid="btn-nuevo-asiento-manual"
                onClick={() => {
                  setModalAsiento(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <span>+</span>
                <span>Asiento Manual</span>
              </button>
            </>
          )}
        </div>
      </div>

      {aviso && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <span>{aviso}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
            }}
            className="text-xs font-bold uppercase underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Subnavegación */}
      <div className="flex border-b border-slate-200 overflow-x-auto">
        <button
          type="button"
          onClick={() => {
            setSubpestana('diario');
          }}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition whitespace-nowrap ${
            subpestana === 'diario'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          1. Libro Diario General
        </button>
        <button
          type="button"
          onClick={() => {
            setSubpestana('sumas_saldos');
          }}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition whitespace-nowrap ${
            subpestana === 'sumas_saldos'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          2. Sumas y Saldos (Balance)
        </button>
        <button
          type="button"
          onClick={() => {
            setSubpestana('plan_cuentas');
          }}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition whitespace-nowrap ${
            subpestana === 'plan_cuentas'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          3. Plan de Cuentas
        </button>
        <button
          type="button"
          onClick={() => {
            setSubpestana('ejercicios');
          }}
          className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition whitespace-nowrap ${
            subpestana === 'ejercicios'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          4. Ejercicios & Cierre
        </button>
      </div>

      {/* 1. SUBPESTAÑA: LIBRO DIARIO GENERAL */}
      {subpestana === 'diario' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
            <div>
              <label htmlFor="filtro-origen-select" className="block text-xs font-medium text-slate-700">
                Origen del Asiento
              </label>
              <select
                id="filtro-origen-select"
                value={filtroOrigen}
                onChange={(e) => {
                  setFiltroOrigen(e.target.value);
                }}
                className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="todos">Todos los orígenes</option>
                <option value="venta">Ventas de salón</option>
                <option value="egreso_caja">Egresos de caja</option>
                <option value="cobro_cta_cte">Cobros cta cte</option>
                <option value="compra_stock">Compras / Ingreso stock</option>
                <option value="pago_proveedor">Pagos a proveedores</option>
                <option value="deposito_cheque">Depósitos de cheques</option>
                <option value="manual">Manuales / Ajustes</option>
              </select>
            </div>

            <div>
              <label htmlFor="filtro-fecha-desde" className="block text-xs font-medium text-slate-700">
                Fecha Desde
              </label>
              <input
                id="filtro-fecha-desde"
                type="date"
                value={filtroFechaDesde}
                onChange={(e) => {
                  setFiltroFechaDesde(e.target.value);
                }}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            <div>
              <label htmlFor="filtro-fecha-hasta" className="block text-xs font-medium text-slate-700">
                Fecha Hasta
              </label>
              <input
                id="filtro-fecha-hasta"
                type="date"
                value={filtroFechaHasta}
                onChange={(e) => {
                  setFiltroFechaHasta(e.target.value);
                }}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void cargarLibroDiario();
                }}
                className="rounded-md bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
              >
                Filtrar
              </button>
              {asientos.length > 0 && (
                <button
                  type="button"
                  onClick={exportarLibroDiarioCSV}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Exportar Libro Diario 📊
                </button>
              )}
            </div>
          </div>

          {cargando ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Cargando asientos del libro diario...
            </div>
          ) : asientos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
              <p className="font-medium">No hay asientos contables registrados con los filtros seleccionados.</p>
              <p className="mt-1 text-xs text-slate-500">
                Podés registrar un nuevo asiento manual con el botón superior.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {asientos.map((a) => (
                <div
                  key={a.id}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-white">
                        Asiento Nº {a.numero}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(a.fecha).toLocaleString('es-AR')}
                      </span>
                      <span className="font-semibold text-slate-800">
                        {a.concepto}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {a.origen}
                      </span>
                      {a.cuadrado ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                          Partida Cuadrada ✓
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800">
                          Desbalanceado ⚠
                        </span>
                      )}
                    </div>
                  </div>

                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100/60 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 font-medium">Código</th>
                        <th className="px-4 py-2 font-medium">Cuenta Imputable</th>
                        <th className="px-4 py-2 font-medium">Detalle Renglón</th>
                        <th className="px-4 py-2 text-right font-medium">Debe</th>
                        <th className="px-4 py-2 text-right font-medium">Haber</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                      {a.renglones.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-500">{r.cuentaCodigo}</td>
                          <td className="px-4 py-2 font-sans font-medium text-slate-800">
                            {r.cuentaNombre}
                          </td>
                          <td className="px-4 py-2 font-sans text-slate-500">
                            {r.descripcion ?? '-'}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-slate-900">
                            {parseFloat(r.debe) > 0 ? formatearPesos(r.debe) : '-'}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-slate-900">
                            {parseFloat(r.haber) > 0 ? formatearPesos(r.haber) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50/50 font-bold">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-right font-sans text-slate-600">
                          Totales Asiento:
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-emerald-700">
                          {formatearPesos(a.totalDebe)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-emerald-700">
                          {formatearPesos(a.totalHaber)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. SUBPESTAÑA: SUMAS Y SALDOS (BALANCE DE COMPROBACIÓN) */}
      {subpestana === 'sumas_saldos' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Balance general de comprobación con saldos deudores y acreedores calculados en tiempo real.
            </p>
            {sumasSaldos.length > 0 && (
              <button
                type="button"
                onClick={exportarSumasSaldosCSV}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Exportar Balance a Excel 📊
              </button>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Código</th>
                  <th className="px-4 py-3 font-semibold">Nombre de la Cuenta</th>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 text-right font-semibold">Total Debe</th>
                  <th className="px-4 py-3 text-right font-semibold">Total Haber</th>
                  <th className="px-4 py-3 text-right font-semibold">Saldo Deudor</th>
                  <th className="px-4 py-3 text-right font-semibold">Saldo Acreedor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
                {sumasSaldos.map((c) => (
                  <tr key={c.cuentaId} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-bold text-slate-600">{c.cuentaCodigo}</td>
                    <td className="px-4 py-2.5 font-sans font-medium text-slate-900">
                      {c.cuentaNombre}
                    </td>
                    <td className="px-4 py-2.5 font-sans">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {c.cuentaTipo}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {parseFloat(c.totalDebe) > 0 ? formatearPesos(c.totalDebe) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {parseFloat(c.totalHaber) > 0 ? formatearPesos(c.totalHaber) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-blue-700">
                      {parseFloat(c.saldoDeudor) > 0 ? formatearPesos(c.saldoDeudor) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-purple-700">
                      {parseFloat(c.saldoAcreedor) > 0 ? formatearPesos(c.saldoAcreedor) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-900">
                <tr>
                  <td colSpan={3} className="px-4 py-3 font-sans text-sm">
                    Totales de Control Contable:
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-900">
                    {formatearPesos((totalDebitosCentavos / 100).toFixed(2))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-900">
                    {formatearPesos((totalCreditosCentavos / 100).toFixed(2))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-blue-900">
                    {formatearPesos((totalSaldosDeudoresCentavos / 100).toFixed(2))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-purple-900">
                    {formatearPesos((totalSaldosAcreedoresCentavos / 100).toFixed(2))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
            <div className="flex items-center gap-4">
              <div>
                <span className="font-semibold text-slate-700">Balance Débito/Crédito: </span>
                {balanceSumasCuadrado ? (
                  <span className="font-bold text-emerald-700">En equilibrio ($ 0.00 diferencia) ✓</span>
                ) : (
                  <span className="font-bold text-red-700">Desbalanceado ⚠</span>
                )}
              </div>
              <div>
                <span className="font-semibold text-slate-700">Balance Saldos Deudor/Acreedor: </span>
                {balanceSaldosCuadrado ? (
                  <span className="font-bold text-emerald-700">En equilibrio ($ 0.00 diferencia) ✓</span>
                ) : (
                  <span className="font-bold text-red-700">Desbalanceado ⚠</span>
                )}
              </div>
            </div>

            <span className="text-slate-500">
              {sumasSaldos.length} cuentas registradas en el balance
            </span>
          </div>
        </div>
      )}

      {/* 3. SUBPESTAÑA: PLAN DE CUENTAS */}
      {subpestana === 'plan_cuentas' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Estructura jerárquica del plan de cuentas imputable.
            </p>
            {puedeGestionar && (
              <button
                type="button"
                onClick={() => {
                  setModalCuenta(true);
                }}
                className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
              >
                + Nueva Cuenta Contable
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cuentas.map((c) => (
              <div
                key={c.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-700">
                      {c.codigo}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 uppercase">
                      {c.tipo}
                    </span>
                  </div>
                  <h4 className="mt-1 text-sm font-semibold text-slate-900">
                    {c.nombre}
                  </h4>
                  {c.descripcion && (
                    <p className="mt-1 text-xs text-slate-500">{c.descripcion}</p>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                  <span>Estado: {c.activa ? 'Activa' : 'Inactiva'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. SUBPESTAÑA: EJERCICIOS CONTABLES & CIERRE */}
      {subpestana === 'ejercicios' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                Períodos Fiscales y Cierres de Ejercicio
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Al cerrar un ejercicio, el sistema genera automáticamente el asiento de refundición de pérdidas/ganancias contra <em>Resultado del Ejercicio</em> y el asiento formal de cierre patrimonial, bloqueando nuevos asientos con fecha en ese período.
              </p>
            </div>
            {puedeGestionar && (
              <button
                type="button"
                onClick={() => {
                  setModalEjercicio(true);
                }}
                className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 transition shrink-0"
              >
                + Abrir Nuevo Ejercicio
              </button>
            )}
          </div>

          {/* Tabla de Ejercicios */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Nº</th>
                    <th className="px-4 py-3">Nombre del Ejercicio</th>
                    <th className="px-4 py-3">Período (Desde - Hasta)</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Asientos de Cierre</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cargando ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Cargando ejercicios contables...
                      </td>
                    </tr>
                  ) : ejercicios.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No hay ejercicios contables registrados. Hacé clic en <strong>+ Abrir Nuevo Ejercicio</strong> para comenzar.
                      </td>
                    </tr>
                  ) : (
                    ejercicios.map((ej) => (
                      <tr key={ej.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          #{ej.numero}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {ej.nombre}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                          {ej.fechaInicio} al {ej.fechaFin}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {ej.estado === 'abierto' ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              🟢 Abierto
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                              🔒 Cerrado
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500 text-[11px]">
                          {ej.estado === 'cerrado' ? (
                            <div className="space-y-0.5">
                              <div>Refundición: <span className="font-mono text-slate-700">{ej.asientoRefundicionId ? 'Generado' : 'Sin saldo'}</span></div>
                              <div>Cierre: <span className="font-mono text-slate-700">{ej.asientoCierreId ? 'Generado' : 'Sin saldo'}</span></div>
                            </div>
                          ) : (
                            <span className="italic text-slate-400">Pendiente de cierre</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {ej.estado === 'abierto' && puedeGestionar ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEjercicioACerrar(ej);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                            >
                              🔒 Cerrar Ejercicio
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs italic">Finalizado</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NUEVO EJERCICIO CONTABLE */}
      {modalEjercicio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Abrir Nuevo Ejercicio Contable
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalEjercicio(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => { void handleGuardarEjercicio(e); }} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre del Ejercicio Fiscal *
                </label>
                <input
                  type="text"
                  required
                  value={nombreEjercicio}
                  onChange={(e) => {
                    setNombreEjercicio(e.target.value);
                  }}
                  placeholder="Ej. Ejercicio Anual 2026"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Fecha de Inicio *
                  </label>
                  <input
                    type="date"
                    required
                    value={fechaInicioEjercicio}
                    onChange={(e) => {
                      setFechaInicioEjercicio(e.target.value);
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Fecha de Fin *
                  </label>
                  <input
                    type="date"
                    required
                    value={fechaFinEjercicio}
                    onChange={(e) => {
                      setFechaFinEjercicio(e.target.value);
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setModalEjercicio(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoEjercicio}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {guardandoEjercicio ? 'Creando...' : 'Crear Ejercicio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMACIÓN DE CIERRE DE EJERCICIO */}
      {ejercicioACerrar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-amber-800 flex items-center gap-2">
                <span>⚠️</span> Cerrar Ejercicio #{ejercicioACerrar.numero}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEjercicioACerrar(null);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-600">
              <p>
                Estás por cerrar formalmente el <strong>{ejercicioACerrar.nombre}</strong> (Período: {ejercicioACerrar.fechaInicio} al {ejercicioACerrar.fechaFin}).
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-900 space-y-1">
                <div className="font-semibold">Efectos del cierre contable:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Se calcularán los saldos de todas las cuentas de Ingresos y Egresos.</li>
                  <li>Se generará automáticamente el <strong>Asiento de Refundición de Resultados</strong>, dejando en cero las cuentas de resultado contra <em>3.2.01 Resultado del Ejercicio</em>.</li>
                  <li>Se generará el <strong>Asiento de Cierre Patrimonial</strong> balanceando Activos, Pasivos y Patrimonio Neto.</li>
                  <li><strong>Quedará bloqueado</strong> el registro de nuevos asientos contables con fecha en este período.</li>
                </ul>
              </div>
              <p className="font-semibold text-slate-800">
                ¿Confirmás que deseás proceder con el cierre contable formal?
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  setEjercicioACerrar(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={cerrandoEjercicio}
                onClick={() => {
                  void handleCerrarEjercicioConfirmado();
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {cerrandoEjercicio ? 'Cerrando y Generando Asientos...' : 'Confirmar Cierre Formal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR ASIENTO MANUAL */}
      {modalAsiento && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                Registrar Asiento Contable Manual
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalAsiento(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                void handleGuardarAsiento(e);
              }}
              className="mt-4 space-y-4"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="concepto-asiento-input" className="block text-xs font-medium text-slate-700">
                    Concepto / Detalle del Asiento *
                  </label>
                  <input
                    id="concepto-asiento-input"
                    type="text"
                    required
                    value={conceptoAsiento}
                    onChange={(e) => {
                      setConceptoAsiento(e.target.value);
                    }}
                    placeholder="Ej. Pago de alquiler de local o aporte de capital"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="origen-asiento-select" className="block text-xs font-medium text-slate-700">
                    Origen
                  </label>
                  <select
                    id="origen-asiento-select"
                    value={origenAsiento}
                    onChange={(e) => {
                      setOrigenAsiento(e.target.value as OrigenAsiento);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="manual">Manual</option>
                    <option value="ajuste">Ajuste Contable</option>
                    <option value="egreso_caja">Egreso de Caja</option>
                  </select>
                </div>
              </div>

              {/* Renglones de partida doble */}
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Renglones de Partida Doble (Mínimo 2)
                  </span>
                  <button
                    type="button"
                    onClick={agregarRenglon}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    + Agregar Renglón
                  </button>
                </div>

                {renglones.map((r, idx) => (
                  <div
                    key={`renglon-${idx}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs"
                  >
                    <div className="flex-1 min-w-[200px]">
                      <select
                        aria-label={`Cuenta para el renglón ${idx + 1}`}
                        required
                        value={r.cuentaId}
                        onChange={(e) => {
                          actualizarRenglon(idx, 'cuentaId', e.target.value);
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                      >
                        <option value="">-- Seleccionar Cuenta --</option>
                        {cuentas.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.codigo} - {c.nombre} ({c.tipo})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="w-28">
                      <input
                        type="text"
                        placeholder="Debe $"
                        value={r.debe}
                        onChange={(e) => {
                          actualizarRenglon(idx, 'debe', e.target.value);
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-right"
                      />
                    </div>

                    <div className="w-28">
                      <input
                        type="text"
                        placeholder="Haber $"
                        value={r.haber}
                        onChange={(e) => {
                          actualizarRenglon(idx, 'haber', e.target.value);
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-right"
                      />
                    </div>

                    <div className="flex-1 min-w-[150px]">
                      <input
                        type="text"
                        placeholder="Nota o comprobante (opcional)"
                        value={r.descripcion}
                        onChange={(e) => {
                          actualizarRenglon(idx, 'descripcion', e.target.value);
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1.5"
                      />
                    </div>

                    {renglones.length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          quitarRenglon(idx);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Control de Partida Doble en Vivo */}
              <div className="rounded-lg border border-slate-200 bg-slate-100 p-3">
                <div className="flex flex-wrap items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-slate-600">Total Debe: </span>
                    <span className="font-bold text-slate-900">
                      {formatearPesos((totalDebeModalCentavos / 100).toFixed(2))}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600">Total Haber: </span>
                    <span className="font-bold text-slate-900">
                      {formatearPesos((totalHaberModalCentavos / 100).toFixed(2))}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600">Diferencia: </span>
                    <span
                      className={`font-bold ${
                        diferenciaModalCentavos === 0 && totalDebeModalCentavos > 0
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {formatearPesos((diferenciaModalCentavos / 100).toFixed(2))}
                    </span>
                  </div>
                </div>

                <div className="mt-2 text-center text-xs">
                  {asientoModalBalanceado ? (
                    <span className="font-semibold text-emerald-800">
                      ✓ Partida doble cuadrada: listo para asentar en el libro diario
                    </span>
                  ) : (
                    <span className="font-medium text-amber-800">
                      ⚠ La partida debe estar balanceada (Total Debe === Total Haber &gt; 0)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalAsiento(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!asientoModalBalanceado || guardandoAsiento}
                  className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {guardandoAsiento ? 'Registrando...' : 'Registrar Asiento Inmutable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVA CUENTA CONTABLE */}
      {modalCuenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                Nueva Cuenta Contable
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalCuenta(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                void handleGuardarCuenta(e);
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label htmlFor="codigo-cuenta-input" className="block text-xs font-medium text-slate-700">
                  Código de Cuenta *
                </label>
                <input
                  id="codigo-cuenta-input"
                  type="text"
                  required
                  value={nuevoCodigo}
                  onChange={(e) => {
                    setNuevoCodigo(e.target.value);
                  }}
                  placeholder="Ej. 1.1.06 o 5.1.05"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="nombre-cuenta-input" className="block text-xs font-medium text-slate-700">
                  Nombre de la Cuenta *
                </label>
                <input
                  id="nombre-cuenta-input"
                  type="text"
                  required
                  value={nuevoNombre}
                  onChange={(e) => {
                    setNuevoNombre(e.target.value);
                  }}
                  placeholder="Ej. Gastos de Publicidad y Marketing"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="tipo-cuenta-select" className="block text-xs font-medium text-slate-700">
                  Tipo de Cuenta *
                </label>
                <select
                  id="tipo-cuenta-select"
                  value={nuevoTipo}
                  onChange={(e) => {
                    setNuevoTipo(e.target.value as TipoCuentaContable);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="activo">Activo</option>
                  <option value="pasivo">Pasivo</option>
                  <option value="patrimonio_neto">Patrimonio Neto</option>
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                </select>
              </div>

              <div>
                <label htmlFor="descripcion-cuenta-input" className="block text-xs font-medium text-slate-700">
                  Descripción
                </label>
                <input
                  id="descripcion-cuenta-input"
                  type="text"
                  value={nuevaDescripcion}
                  onChange={(e) => {
                    setNuevaDescripcion(e.target.value);
                  }}
                  placeholder="Detalles sobre el uso de la cuenta"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalCuenta(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoCuenta}
                  className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {guardandoCuenta ? 'Guardando...' : 'Crear Cuenta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
