import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import { formatearPesos } from './App.js';
import { apiUrl } from './api-url.js';
import type {
  EstadoCheque,
  ItemFlujoCajaProyectado,
  RolUsuario,
  TipoCheque,
} from '@ferreteria/shared';

export interface ChequeItem {
  id: string;
  tipo: TipoCheque;
  numero: string;
  banco: string;
  cuitEmisor: string | null;
  titular: string | null;
  fechaEmision: string;
  fechaPago: string;
  monto: string;
  estado: EstadoCheque;
  clienteId: string | null;
  clienteNombre: string | null;
  proveedorId: string | null;
  proveedorRazonSocial: string | null;
  cuentaBancariaDestino: string | null;
  fechaDeposito: string | null;
  fechaEntrega: string | null;
  notas: string | null;
  creadoEn: string;
}

export interface ProveedorSimple {
  id: string;
  codigo: string;
  razonSocial: string;
}

export interface TesoreriaFlujoProps {
  token: string;
  rolUsuario: RolUsuario;
  turnoAbiertoId: string | null;
}

export function TesoreriaFlujo({
  token,
  rolUsuario,
}: TesoreriaFlujoProps): ReactElement {
  const [subpestana, setSubpestana] = useState<'cheques' | 'flujo'>('cheques');
  const [cheques, setCheques] = useState<ChequeItem[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorSimple[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');
  const [aviso, setAviso] = useState<string | null>(null);

  // Cash flow proyectado
  const [diasProyeccion, setDiasProyeccion] = useState<number>(30);
  const [flujoItems, setFlujoItems] = useState<ItemFlujoCajaProyectado[]>([]);
  const [totalIngresosProy, setTotalIngresosProy] = useState<string>('0.00');
  const [totalEgresosProy, setTotalEgresosProy] = useState<string>('0.00');
  const [saldoNetoProy, setSaldoNetoProy] = useState<string>('0.00');
  const [cargandoFlujo, setCargandoFlujo] = useState<boolean>(false);

  // Modales
  const [modalNuevoCheque, setModalNuevoCheque] = useState<boolean>(false);
  const [modalDeposito, setModalDeposito] = useState<boolean>(false);
  const [modalEndoso, setModalEndoso] = useState<boolean>(false);
  const [modalRechazo, setModalRechazo] = useState<boolean>(false);
  const [chequeSeleccionado, setChequeSeleccionado] = useState<ChequeItem | null>(null);

  // Inputs modal nuevo cheque
  const [formTipo, setFormTipo] = useState<TipoCheque>('fisico');
  const [formNumero, setFormNumero] = useState<string>('');
  const [formBanco, setFormBanco] = useState<string>('');
  const [formCuitEmisor, setFormCuitEmisor] = useState<string>('');
  const [formTitular, setFormTitular] = useState<string>('');
  const [formFechaPago, setFormFechaPago] = useState<string>('');
  const [formMonto, setFormMonto] = useState<string>('');
  const [formNotas, setFormNotas] = useState<string>('');
  const [guardandoCheque, setGuardandoCheque] = useState<boolean>(false);

  // Inputs modal depósito
  const [depositoCuenta, setDepositoCuenta] = useState<string>('');
  const [depositoFecha, setDepositoFecha] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [depositoNotas, setDepositoNotas] = useState<string>('');
  const [guardandoDeposito, setGuardandoDeposito] = useState<boolean>(false);

  // Inputs modal endoso
  const [endosoProveedorId, setEndosoProveedorId] = useState<string>('');
  const [endosoFecha, setEndosoFecha] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [endosoNotas, setEndosoNotas] = useState<string>('');
  const [guardandoEndoso, setGuardandoEndoso] = useState<boolean>(false);

  // Inputs modal rechazo
  const [rechazoMotivo, setRechazoMotivo] = useState<string>('');
  const [guardandoRechazo, setGuardandoRechazo] = useState<boolean>(false);

  // Cargar lista de cheques
  const cargarCheques = useCallback(async () => {
    setCargando(true);
    setAviso(null);
    try {
      const params = new URLSearchParams();
      if (filtroEstado !== 'todos') params.set('estado', filtroEstado);
      if (filtroTipo !== 'todos') params.set('tipo', filtroTipo);

      const res = await fetch(apiUrl(`/tesoreria/cheques?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('No se pudo cargar la cartera de cheques.');
      }
      const data = (await res.json()) as ChequeItem[];
      setCheques(data);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al cargar cheques.');
    } finally {
      setCargando(false);
    }
  }, [filtroEstado, filtroTipo, token]);

  // Cargar proveedores para endoso
  const cargarProveedores = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/proveedores'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ProveedorSimple[];
        setProveedores(data);
      }
    } catch {
      // Ignorar error secundario de proveedores
    }
  }, [token]);

  // Cargar Flujo de Caja Proyectado
  const cargarFlujoProyectado = useCallback(async () => {
    setCargandoFlujo(true);
    setAviso(null);
    try {
      const res = await fetch(
        apiUrl(`/tesoreria/flujo-proyectado?dias=${diasProyeccion}`),
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        throw new Error('No se pudo cargar la proyección de flujo de fondos.');
      }
      const data = (await res.json()) as {
        items: ItemFlujoCajaProyectado[];
        totalIngresos: string;
        totalEgresos: string;
        saldoNetoProyectado: string;
      };
      setFlujoItems(data.items);
      setTotalIngresosProy(data.totalIngresos);
      setTotalEgresosProy(data.totalEgresos);
      setSaldoNetoProy(data.saldoNetoProyectado);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al proyectar flujo.');
    } finally {
      setCargandoFlujo(false);
    }
  }, [diasProyeccion, token]);

  useEffect(() => {
    if (subpestana === 'cheques') {
      void cargarCheques();
      void cargarProveedores();
    } else {
      void cargarFlujoProyectado();
    }
  }, [subpestana, cargarCheques, cargarProveedores, cargarFlujoProyectado]);

  // Registrar Cheque
  const handleGuardarCheque = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    const montoNum = parseFloat(formMonto);
    if (isNaN(montoNum) || montoNum <= 0) {
      setAviso('El monto del cheque debe ser mayor a cero.');
      return;
    }
    if (!formFechaPago) {
      setAviso('La fecha de pago o vencimiento es obligatoria.');
      return;
    }

    setGuardandoCheque(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/tesoreria/cheques'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tipo: formTipo,
          numero: formNumero.trim(),
          banco: formBanco.trim(),
          cuitEmisor: formCuitEmisor.trim() || undefined,
          titular: formTitular.trim() || undefined,
          fechaPago: formFechaPago,
          monto: montoNum.toFixed(2),
          notas: formNotas.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? 'Error al guardar el cheque.');
      }

      setModalNuevoCheque(false);
      setFormNumero('');
      setFormBanco('');
      setFormCuitEmisor('');
      setFormTitular('');
      setFormFechaPago('');
      setFormMonto('');
      setFormNotas('');
      void cargarCheques();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al registrar el cheque.');
    } finally {
      setGuardandoCheque(false);
    }
  };

  // Depositar Cheque
  const handleDepositarCheque = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!chequeSeleccionado) return;

    setGuardandoDeposito(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl(`/tesoreria/cheques/${chequeSeleccionado.id}/depositar`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cuentaBancariaDestino: depositoCuenta.trim(),
          fechaDeposito: depositoFecha,
          notas: depositoNotas.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? 'Error al depositar el cheque.');
      }

      setModalDeposito(false);
      setChequeSeleccionado(null);
      void cargarCheques();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al registrar depósito.');
    } finally {
      setGuardandoDeposito(false);
    }
  };

  // Endosar Cheque a Proveedor
  const handleEndosarCheque = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!chequeSeleccionado || !endosoProveedorId) {
      setAviso('Debes seleccionar un proveedor para endosar el cheque.');
      return;
    }

    setGuardandoEndoso(true);
    setAviso(null);
    try {
      const res = await fetch(
        apiUrl(`/tesoreria/cheques/${chequeSeleccionado.id}/endosar-proveedor`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            proveedorId: endosoProveedorId,
            fechaEntrega: endosoFecha,
            notas: endosoNotas.trim() || undefined,
          }),
        },
      );

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? 'Error al endosar cheque.');
      }

      setModalEndoso(false);
      setChequeSeleccionado(null);
      void cargarCheques();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al endosar cheque.');
    } finally {
      setGuardandoEndoso(false);
    }
  };

  // Rechazar Cheque
  const handleRechazarCheque = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!chequeSeleccionado || !rechazoMotivo.trim()) {
      setAviso('Debes ingresar el motivo del rechazo.');
      return;
    }

    setGuardandoRechazo(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl(`/tesoreria/cheques/${chequeSeleccionado.id}/rechazar`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          motivo: rechazoMotivo.trim(),
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? 'Error al registrar rechazo.');
      }

      setModalRechazo(false);
      setChequeSeleccionado(null);
      void cargarCheques();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al rechazar cheque.');
    } finally {
      setGuardandoRechazo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Aviso Superior */}
      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm flex items-center justify-between">
          <span>{aviso}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
            }}
            className="text-amber-700 font-bold hover:underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Navegación Subpestañas: Cheques vs Flujo Proyectado */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="tab-sub-cheques"
            onClick={() => {
              setSubpestana('cheques');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              subpestana === 'cheques'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📑 Cartera de Cheques y eCheqs
          </button>
          <button
            type="button"
            data-testid="tab-sub-flujo"
            onClick={() => {
              setSubpestana('flujo');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              subpestana === 'flujo'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📈 Flujo de Fondos Proyectado
          </button>
        </div>

        {subpestana === 'cheques' && (
          <button
            type="button"
            data-testid="btn-nuevo-cheque"
            onClick={() => {
              setModalNuevoCheque(true);
            }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
          >
            + Ingresar Cheque
          </button>
        )}
      </div>

      {/* SUBPESTAÑA 1: CARTERA DE CHEQUES */}
      {subpestana === 'cheques' && (
        <div className="space-y-6">
          {/* Filtros */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label htmlFor="select-filtro-estado" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Estado del Cheque
              </label>
              <select
                id="select-filtro-estado"
                value={filtroEstado}
                onChange={(e) => {
                  setFiltroEstado(e.target.value);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              >
                <option value="todos">Todos los estados</option>
                <option value="en_cartera">En Cartera (Disponibles)</option>
                <option value="depositado">Depositados</option>
                <option value="entregado_proveedor">Entregados a Proveedores</option>
                <option value="rechazado">Rechazados</option>
              </select>
            </div>

            <div>
              <label htmlFor="select-filtro-tipo" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Tipo de Soporte
              </label>
              <select
                id="select-filtro-tipo"
                value={filtroTipo}
                onChange={(e) => {
                  setFiltroTipo(e.target.value);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              >
                <option value="todos">Físicos y eCheqs</option>
                <option value="fisico">Cheques Físicos</option>
                <option value="echeq">eCheqs Electrónicos</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  void cargarCheques();
                }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 w-full"
              >
                Actualizar Cartera
              </button>
            </div>
          </div>

          {/* Tabla de Cheques */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Tipo / Número</th>
                  <th className="px-4 py-3">Banco / Emisor</th>
                  <th className="px-4 py-3">Fecha de Cobro</th>
                  <th className="px-4 py-3 text-right">Importe</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cargando ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      Cargando cheques...
                    </td>
                  </tr>
                ) : cheques.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No se encontraron cheques con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  cheques.map((ch) => (
                    <tr key={ch.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 font-mono">
                          {ch.tipo === 'echeq' ? '⚡ ' : '📄 '}
                          {ch.numero}
                        </div>
                        <div className="text-xs text-slate-500 uppercase font-semibold">
                          {ch.tipo}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{ch.banco}</div>
                        <div className="text-xs text-slate-500">
                          {ch.titular ? `${ch.titular} ` : ''}
                          {ch.cuitEmisor ? `(CUIT: ${ch.cuitEmisor})` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {new Date(ch.fechaPago).toLocaleDateString('es-AR')}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                        {formatearPesos(ch.monto)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                            ch.estado === 'en_cartera'
                              ? 'bg-emerald-100 text-emerald-800'
                              : ch.estado === 'depositado'
                              ? 'bg-blue-100 text-blue-800'
                              : ch.estado === 'entregado_proveedor'
                              ? 'bg-purple-100 text-purple-800'
                              : ch.estado === 'rechazado'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {ch.estado.replace('_', ' ')}
                        </span>
                        {ch.proveedorRazonSocial && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            → {ch.proveedorRazonSocial}
                          </div>
                        )}
                        {ch.cuentaBancariaDestino && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            🏦 {ch.cuentaBancariaDestino}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ch.estado === 'en_cartera' && rolUsuario !== 'cajero' && (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              data-testid={`btn-depositar-${ch.id}`}
                              onClick={() => {
                                setChequeSeleccionado(ch);
                                setModalDeposito(true);
                              }}
                              className="rounded bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 border border-blue-200"
                            >
                              Depositar
                            </button>
                            <button
                              type="button"
                              data-testid={`btn-endosar-${ch.id}`}
                              onClick={() => {
                                setChequeSeleccionado(ch);
                                setModalEndoso(true);
                              }}
                              className="rounded bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-700 hover:bg-purple-100 border border-purple-200"
                            >
                              Endosar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setChequeSeleccionado(ch);
                                setModalRechazo(true);
                              }}
                              className="rounded bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 border border-rose-200"
                            >
                              Rechazar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBPESTAÑA 2: FLUJO DE FONDOS PROYECTADO */}
      {subpestana === 'flujo' && (
        <div className="space-y-6">
          {/* Selector de Plazo y Métricas Consolidadas */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Horizonte de proyección:
              </span>
              <div className="flex gap-1.5">
                {[7, 14, 30, 60].map((dias) => (
                  <button
                    key={dias}
                    type="button"
                    onClick={() => {
                      setDiasProyeccion(dias);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      diasProyeccion === dias
                        ? 'bg-slate-900 text-white shadow'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {dias} días
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void cargarFlujoProyectado();
              }}
              className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Recalcular Proyección
            </button>
          </div>

          {/* Tarjetas de Saldo Proyectado */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block">
                Ingresos Estimados (+ Tarjetas y Cheques)
              </span>
              <span className="font-mono text-xl font-bold text-emerald-700 mt-1 block">
                {formatearPesos(totalIngresosProy)}
              </span>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
              <span className="text-xs font-semibold text-rose-800 uppercase tracking-wider block">
                Egresos Estimados (- Facturas Proveedores)
              </span>
              <span className="font-mono text-xl font-bold text-rose-700 mt-1 block">
                {formatearPesos(totalEgresosProy)}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                Flujo Neto Proyectado ({diasProyeccion} días)
              </span>
              <span
                className={`font-mono text-xl font-bold mt-1 block ${
                  parseFloat(saldoNetoProy) >= 0 ? 'text-slate-900' : 'text-rose-600'
                }`}
              >
                {formatearPesos(saldoNetoProy)}
              </span>
            </div>
          </div>

          {/* Cronograma Proyectado */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Fecha Estimada</th>
                  <th className="px-4 py-3">Concepto / Descripción</th>
                  <th className="px-4 py-3">Origen / Destino</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cargandoFlujo ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      Calculando flujo proyectado...
                    </td>
                  </tr>
                ) : flujoItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      No hay vencimientos de cheques, tarjetas ni proveedores en el período seleccionado.
                    </td>
                  </tr>
                ) : (
                  flujoItems.map((item, idx) => {
                    const esIngreso = item.sentido === 'ingreso';
                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {new Date(item.fecha).toLocaleDateString('es-AR')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">{item.descripcion}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                              item.tipo === 'cheque_en_cartera'
                                ? 'bg-emerald-100 text-emerald-800'
                                : item.tipo === 'acreditacion_tarjeta'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {item.tipo.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
                          <span className={esIngreso ? 'text-emerald-600' : 'text-rose-600'}>
                            {esIngreso ? '+' : '-'} {formatearPesos(item.monto)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: INGRESAR CHEQUE */}
      {modalNuevoCheque && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Ingresar Cheque a Cartera</h3>

            <form onSubmit={(e) => void handleGuardarCheque(e)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="select-modal-tipo-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Tipo de Cheque
                  </label>
                  <select
                    id="select-modal-tipo-ch"
                    value={formTipo}
                    onChange={(e) => {
                      setFormTipo(e.target.value as TipoCheque);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  >
                    <option value="fisico">Físico (Papel)</option>
                    <option value="echeq">eCheq Electrónico</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="input-modal-numero-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Número de Cheque *
                  </label>
                  <input
                    id="input-modal-numero-ch"
                    type="text"
                    required
                    value={formNumero}
                    onChange={(e) => {
                      setFormNumero(e.target.value);
                    }}
                    placeholder="Ej: 00492811"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="input-modal-banco-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Banco Emisor *
                  </label>
                  <input
                    id="input-modal-banco-ch"
                    type="text"
                    required
                    value={formBanco}
                    onChange={(e) => {
                      setFormBanco(e.target.value);
                    }}
                    placeholder="Ej: Banco Galicia"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="input-modal-cuit-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    CUIT del Emisor
                  </label>
                  <input
                    id="input-modal-cuit-ch"
                    type="text"
                    value={formCuitEmisor}
                    onChange={(e) => {
                      setFormCuitEmisor(e.target.value);
                    }}
                    placeholder="30-00000000-0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="input-modal-titular-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Titular / Razón Social Emisora
                </label>
                <input
                  id="input-modal-titular-ch"
                  type="text"
                  value={formTitular}
                  onChange={(e) => {
                    setFormTitular(e.target.value);
                  }}
                  placeholder="Ej: Juan Pérez o Constructora del Sol SA"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="input-modal-fecha-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Fecha de Pago / Cobro *
                  </label>
                  <input
                    id="input-modal-fecha-ch"
                    type="date"
                    required
                    value={formFechaPago}
                    onChange={(e) => {
                      setFormFechaPago(e.target.value);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="input-modal-monto-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Importe ($) *
                  </label>
                  <input
                    id="input-modal-monto-ch"
                    type="number"
                    step="0.01"
                    required
                    value={formMonto}
                    onChange={(e) => {
                      setFormMonto(e.target.value);
                    }}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold focus:border-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="input-modal-notas-ch" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Observaciones
                </label>
                <input
                  id="input-modal-notas-ch"
                  type="text"
                  value={formNotas}
                  onChange={(e) => {
                    setFormNotas(e.target.value);
                  }}
                  placeholder="Ej: Cobrado a cliente por materiales"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalNuevoCheque(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoCheque}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  {guardandoCheque ? 'Guardando...' : 'Ingresar a Cartera'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DEPOSITAR CHEQUE */}
      {modalDeposito && chequeSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Depositar Cheque en Banco</h3>
            <p className="text-xs text-slate-600">
              Cheque {chequeSeleccionado.banco} Nº {chequeSeleccionado.numero} por{' '}
              <span className="font-bold text-slate-900">{formatearPesos(chequeSeleccionado.monto)}</span>
            </p>

            <form onSubmit={(e) => void handleDepositarCheque(e)} className="space-y-4">
              <div>
                <label htmlFor="input-modal-dep-cta" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Cuenta Bancaria de Destino *
                </label>
                <input
                  id="input-modal-dep-cta"
                  type="text"
                  required
                  value={depositoCuenta}
                  onChange={(e) => {
                    setDepositoCuenta(e.target.value);
                  }}
                  placeholder="Ej: CC en Pesos Banco Nación 0492-38"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="input-modal-dep-fecha" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Fecha del Depósito *
                </label>
                <input
                  id="input-modal-dep-fecha"
                  type="date"
                  required
                  value={depositoFecha}
                  onChange={(e) => {
                    setDepositoFecha(e.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="input-modal-dep-notas" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Notas de Operación
                </label>
                <input
                  id="input-modal-dep-notas"
                  type="text"
                  value={depositoNotas}
                  onChange={(e) => {
                    setDepositoNotas(e.target.value);
                  }}
                  placeholder="Ej: Nro de comprobante o sucursal"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalDeposito(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoDeposito}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700 disabled:opacity-50"
                >
                  {guardandoDeposito ? 'Registrando...' : 'Confirmar Depósito'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ENDOSAR A PROVEEDOR */}
      {modalEndoso && chequeSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Endosar Cheque a Proveedor</h3>
            <p className="text-xs text-slate-600">
              Al endosar este cheque ({formatearPesos(chequeSeleccionado.monto)}), se acreditará automáticamente el monto en el libro inmutable de cuenta corriente del proveedor seleccionado.
            </p>

            <form onSubmit={(e) => void handleEndosarCheque(e)} className="space-y-4">
              <div>
                <label htmlFor="select-modal-end-prov" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Proveedor de Destino *
                </label>
                <select
                  id="select-modal-end-prov"
                  required
                  value={endosoProveedorId}
                  onChange={(e) => {
                    setEndosoProveedorId(e.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                >
                  <option value="">Seleccione un proveedor...</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razonSocial} ({p.codigo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="input-modal-end-fecha" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Fecha de Entrega / Endoso *
                </label>
                <input
                  id="input-modal-end-fecha"
                  type="date"
                  required
                  value={endosoFecha}
                  onChange={(e) => {
                    setEndosoFecha(e.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="input-modal-end-notas" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Observaciones / Recibo de Pago
                </label>
                <input
                  id="input-modal-end-notas"
                  type="text"
                  value={endosoNotas}
                  onChange={(e) => {
                    setEndosoNotas(e.target.value);
                  }}
                  placeholder="Ej: Pago parcial Factura A-0001"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalEndoso(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoEndoso}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-purple-700 disabled:opacity-50"
                >
                  {guardandoEndoso ? 'Endosando...' : 'Confirmar Endoso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECHAZAR CHEQUE */}
      {modalRechazo && chequeSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-rose-700">Marcar Cheque como Rechazado</h3>
            <p className="text-xs text-slate-600">
              Cheque {chequeSeleccionado.banco} Nº {chequeSeleccionado.numero} por{' '}
              <span className="font-bold text-slate-900">{formatearPesos(chequeSeleccionado.monto)}</span>
            </p>

            <form onSubmit={(e) => void handleRechazarCheque(e)} className="space-y-4">
              <div>
                <label htmlFor="input-modal-rech-motivo" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Motivo de Rechazo *
                </label>
                <textarea
                  id="input-modal-rech-motivo"
                  required
                  rows={3}
                  value={rechazoMotivo}
                  onChange={(e) => {
                    setRechazoMotivo(e.target.value);
                  }}
                  placeholder="Ej: Sin fondos, firma defectuosa, orden de no pago"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalRechazo(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoRechazo}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-rose-700 disabled:opacity-50"
                >
                  {guardandoRechazo ? 'Procesando...' : 'Registrar Rechazo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
