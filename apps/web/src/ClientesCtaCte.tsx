import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import {
  formatearPesos,
} from './App.js';
import { apiUrl } from './api-url.js';
import type { CondicionIva, RolUsuario } from '@ferreteria/shared';

export interface ClienteItem {
  id: string;
  codigo: string;
  nombre: string;
  cuitDni: string | null;
  condicionIva: CondicionIva;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  listaPrecioId: string | null;
  listaPrecioNombre: string | null;
  limiteCredito: string;
  diasPlazoCredito: number;
  activo: boolean;
  totalDebitos: string;
  totalCreditos: string;
  saldoDeudor: string;
  creditoDisponible: string;
  excedidoLimite: boolean;
}

export interface ClienteAutorizadoItem {
  id: string;
  clienteId: string;
  nombre: string;
  dni: string | null;
  rolParentesco: string | null;
  telefono: string | null;
  activo: boolean;
  creadoEn?: string;
}

export interface MovimientoCtaCteItem {
  id: string;
  tipo: string;
  sentido: 'debito' | 'credito';
  monto: string;
  descripcion: string | null;
  ventaId: string | null;
  movimientoCajaId: string | null;
  revierteId: string | null;
  creadoEn: string;
  autorizadoNombre: string | null;
  autorizadoDni: string | null;
  usuarioNombre: string | null;
}

export interface ClientesCtaCteProps {
  token: string;
  rolUsuario: RolUsuario;
  turnoAbiertoId: string | null;
  mediosPago: Array<{ id: string; nombre: string; esEfectivo: boolean }>;
  listasPrecios?: Array<{ id: string; nombre: string }>;
  onCobranzaRegistrada?: () => void;
}

export function ClientesCtaCte({
  token,
  rolUsuario,
  turnoAbiertoId,
  mediosPago,
  listasPrecios = [],
  onCobranzaRegistrada,
}: ClientesCtaCteProps): ReactElement {
  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [busqueda, setBusqueda] = useState<string>('');
  const [soloConDeuda, setSoloConDeuda] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modales
  const [modalClienteAbierto, setModalClienteAbierto] = useState<boolean>(false);
  const [clienteEnEdicion, setClienteEnEdicion] = useState<ClienteItem | null>(null);

  // Ficha de cliente & extracto
  const [clienteSeleccionado, setClienteSeleccionado] = useState<ClienteItem | null>(null);
  const [autorizados, setAutorizados] = useState<ClienteAutorizadoItem[]>([]);
  const [movimientosCtaCte, setMovimientosCtaCte] = useState<MovimientoCtaCteItem[]>([]);
  const [saldoDeudorDetalle, setSaldoDeudorDetalle] = useState<string>('0.00');
  const [tabFicha, setTabFicha] = useState<'movimientos' | 'autorizados'>('movimientos');
  const [cargandoDetalle, setCargandoDetalle] = useState<boolean>(false);

  // Modal Cobranza
  const [modalCobranzaAbierto, setModalCobranzaAbierto] = useState<boolean>(false);
  const [clienteParaCobro, setClienteParaCobro] = useState<ClienteItem | null>(null);
  const [cobranzaMonto, setCobranzaMonto] = useState<string>('0.00');
  const [cobranzaMedioPagoId, setCobranzaMedioPagoId] = useState<string>(
    mediosPago[0]?.id ?? '',
  );
  const [cobranzaDescripcion, setCobranzaDescripcion] = useState<string>('');
  const [guardandoCobro, setGuardandoCobro] = useState<boolean>(false);

  // Modal Ajuste Manual
  const [modalAjusteAbierto, setModalAjusteAbierto] = useState<boolean>(false);
  const [ajusteTipo, setAjusteTipo] = useState<'ajuste_debito' | 'ajuste_credito'>('ajuste_debito');
  const [ajusteMonto, setAjusteMonto] = useState<string>('0.00');
  const [ajusteDescripcion, setAjusteDescripcion] = useState<string>('');
  const [guardandoAjuste, setGuardandoAjuste] = useState<boolean>(false);

  // Formulario Nuevo / Editar Cliente
  const [formCodigo, setFormCodigo] = useState<string>('');
  const [formNombre, setFormNombre] = useState<string>('');
  const [formCuitDni, setFormCuitDni] = useState<string>('');
  const [formCondicionIva, setFormCondicionIva] = useState<CondicionIva>('consumidor_final');
  const [formTelefono, setFormTelefono] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formDireccion, setFormDireccion] = useState<string>('');
  const [formListaPrecioId, setFormListaPrecioId] = useState<string>('');
  const [formLimiteCredito, setFormLimiteCredito] = useState<string>('0.00');
  const [formDiasPlazoCredito, setFormDiasPlazoCredito] = useState<number>(30);
  const [formNotas, setFormNotas] = useState<string>('');
  const [guardandoCliente, setGuardandoCliente] = useState<boolean>(false);

  // Formulario Nuevo Autorizado
  const [autNombre, setAutNombre] = useState<string>('');
  const [autDni, setAutDni] = useState<string>('');
  const [autRol, setAutRol] = useState<string>('');
  const [autTelefono, setAutTelefono] = useState<string>('');
  const [guardandoAutorizado, setGuardandoAutorizado] = useState<boolean>(false);

  // Cargar lista de clientes
  const cargarClientes = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (busqueda.trim()) {
        params.set('q', busqueda.trim());
      }
      if (soloConDeuda) {
        params.set('soloConDeuda', 'true');
      }

      const res = await fetch(apiUrl(`/api/clientes?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('Error al consultar clientes');
      }
      const data = (await res.json()) as ClienteItem[];
      setClientes(data);
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error al cargar clientes');
    } finally {
      setCargando(false);
    }
  }, [busqueda, soloConDeuda, token]);

  useEffect(() => {
    void cargarClientes();
  }, [cargarClientes]);

  // Cargar ficha y extracto del cliente
  const abrirFichaCliente = useCallback(
    async (c: ClienteItem) => {
      setClienteSeleccionado(c);
      setTabFicha('movimientos');
      setCargandoDetalle(true);
      try {
        const [resDetalle, resExtracto] = await Promise.all([
          fetch(apiUrl(`/api/clientes/${c.id}`), {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(apiUrl(`/api/clientes/${c.id}/cuenta-corriente`), {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (resDetalle.ok) {
          const dataDet = (await resDetalle.json()) as {
            cliente: ClienteItem;
            autorizados: ClienteAutorizadoItem[];
          };
          setClienteSeleccionado(dataDet.cliente);
          setAutorizados(dataDet.autorizados);
        }

        if (resExtracto.ok) {
          const dataExt = (await resExtracto.json()) as {
            movimientos: MovimientoCtaCteItem[];
            saldoDeudor: string;
          };
          setMovimientosCtaCte(dataExt.movimientos);
          setSaldoDeudorDetalle(dataExt.saldoDeudor);
        }
      } catch (err: unknown) {
        setAviso(
          err instanceof Error
            ? err.message
            : 'Error al cargar ficha de cuenta corriente',
        );
      } finally {
        setCargandoDetalle(false);
      }
    },
    [token],
  );

  // Abrir modal de nuevo / edición
  const abrirModalNuevo = () => {
    setClienteEnEdicion(null);
    setFormCodigo('');
    setFormNombre('');
    setFormCuitDni('');
    setFormCondicionIva('consumidor_final');
    setFormTelefono('');
    setFormEmail('');
    setFormDireccion('');
    setFormListaPrecioId(listasPrecios[0]?.id ?? '');
    setFormLimiteCredito('0.00');
    setFormDiasPlazoCredito(30);
    setFormNotas('');
    setModalClienteAbierto(true);
  };

  const abrirModalEditar = (c: ClienteItem) => {
    setClienteEnEdicion(c);
    setFormCodigo(c.codigo);
    setFormNombre(c.nombre);
    setFormCuitDni(c.cuitDni ?? '');
    setFormCondicionIva(c.condicionIva);
    setFormTelefono(c.telefono ?? '');
    setFormEmail(c.email ?? '');
    setFormDireccion(c.direccion ?? '');
    setFormListaPrecioId(c.listaPrecioId ?? listasPrecios[0]?.id ?? '');
    setFormLimiteCredito(c.limiteCredito);
    setFormDiasPlazoCredito(c.diasPlazoCredito);
    setFormNotas('');
    setModalClienteAbierto(true);
  };

  // Guardar cliente (POST / PUT)
  const guardarCliente = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!formNombre.trim()) {
      setAviso('El nombre o razón social es obligatorio');
      return;
    }
    setGuardandoCliente(true);
    try {
      const payload = {
        codigo: formCodigo.trim() || undefined,
        nombre: formNombre.trim(),
        cuitDni: formCuitDni.trim() || undefined,
        condicionIva: formCondicionIva,
        telefono: formTelefono.trim() || undefined,
        email: formEmail.trim() || undefined,
        direccion: formDireccion.trim() || undefined,
        listaPrecioId: formListaPrecioId || undefined,
        limiteCredito: formLimiteCredito.trim() || '0.00',
        diasPlazoCredito: formDiasPlazoCredito || 30,
        notas: formNotas.trim() || undefined,
      };

      const url = clienteEnEdicion
        ? apiUrl(`/api/clientes/${clienteEnEdicion.id}`)
        : apiUrl('/api/clientes');
      const method = clienteEnEdicion ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error || 'Error al guardar cliente');
      }

      setModalClienteAbierto(false);
      setAviso(
        clienteEnEdicion
          ? `Cliente "${formNombre}" modificado con éxito.`
          : `Cliente "${formNombre}" creado con éxito.`,
      );
      await cargarClientes();
      if (clienteSeleccionado && clienteEnEdicion?.id === clienteSeleccionado.id) {
        await abrirFichaCliente(clienteSeleccionado);
      }
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error al guardar cliente');
    } finally {
      setGuardandoCliente(false);
    }
  };

  // Abrir modal de cobro
  const prepararCobro = (c: ClienteItem) => {
    setClienteParaCobro(c);
    setCobranzaMonto(c.saldoDeudor !== '0.00' ? c.saldoDeudor : '0.00');
    setCobranzaMedioPagoId(mediosPago[0]?.id ?? '');
    setCobranzaDescripcion(`Cobranza cta cte ${c.codigo} · ${c.nombre}`);
    setModalCobranzaAbierto(true);
  };

  // Enviar cobranza a caja
  const registrarCobro = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!clienteParaCobro) return;

    if (!turnoAbiertoId) {
      setAviso('No hay un turno de caja abierto para ingresar la cobranza.');
      return;
    }
    if (parseFloat(cobranzaMonto) <= 0) {
      setAviso('El monto a cobrar debe ser mayor a $ 0,00.');
      return;
    }

    setGuardandoCobro(true);
    try {
      const payload = {
        turnoId: turnoAbiertoId,
        medioPagoId: cobranzaMedioPagoId,
        monto: cobranzaMonto,
        descripcion: cobranzaDescripcion.trim() || undefined,
      };

      const res = await fetch(apiUrl(`/api/clientes/${clienteParaCobro.id}/cobranzas`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error || 'Error al registrar cobranza');
      }

      setModalCobranzaAbierto(false);
      setAviso(
        `Cobranza de ${formatearPesos(cobranzaMonto)} registrada exitosamente para ${clienteParaCobro.nombre}.`,
      );
      onCobranzaRegistrada?.();
      await cargarClientes();
      if (clienteSeleccionado?.id === clienteParaCobro.id) {
        await abrirFichaCliente(clienteSeleccionado);
      }
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error al registrar cobranza');
    } finally {
      setGuardandoCobro(false);
    }
  };

  // Registrar ajuste manual
  const registrarAjuste = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!clienteSeleccionado) return;
    if (parseFloat(ajusteMonto) <= 0) {
      setAviso('El monto del ajuste debe ser mayor a 0');
      return;
    }
    if (!ajusteDescripcion.trim()) {
      setAviso('Debe ingresar un motivo para el ajuste manual.');
      return;
    }

    setGuardandoAjuste(true);
    try {
      const res = await fetch(apiUrl(`/api/clientes/${clienteSeleccionado.id}/ajustes`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tipo: ajusteTipo,
          monto: ajusteMonto,
          descripcion: ajusteDescripcion.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error || 'Error al registrar ajuste');
      }

      setModalAjusteAbierto(false);
      setAviso('Ajuste de cuenta corriente registrado correctamente.');
      await abrirFichaCliente(clienteSeleccionado);
      await cargarClientes();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error al registrar ajuste');
    } finally {
      setGuardandoAjuste(false);
    }
  };

  // Agregar persona autorizada
  const registrarAutorizado = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!clienteSeleccionado) return;
    if (!autNombre.trim()) {
      setAviso('El nombre de la persona autorizada es obligatorio.');
      return;
    }

    setGuardandoAutorizado(true);
    try {
      const res = await fetch(apiUrl(`/api/clientes/${clienteSeleccionado.id}/autorizados`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: autNombre.trim(),
          dni: autDni.trim() || undefined,
          rolParentesco: autRol.trim() || undefined,
          telefono: autTelefono.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error || 'Error al agregar autorizado');
      }

      setAutNombre('');
      setAutDni('');
      setAutRol('');
      setAutTelefono('');
      setAviso('Persona autorizada agregada.');
      await abrirFichaCliente(clienteSeleccionado);
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error al registrar persona autorizada');
    } finally {
      setGuardandoAutorizado(false);
    }
  };

  // Totales de resumen
  const totalDeudaGeneral = clientes.reduce(
    (acc, c) => acc + (parseFloat(c.saldoDeudor) || 0),
    0,
  );
  const clientesConDeudaCount = clientes.filter(
    (c) => (parseFloat(c.saldoDeudor) || 0) > 0,
  ).length;

  return (
    <section className="space-y-6" data-testid="clientes-cta-cte-section">
      {/* Aviso / Notificación */}
      {aviso && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950 shadow-sm"
        >
          <span>{aviso}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
            }}
            className="text-sky-800 hover:text-sky-950 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Barra superior de métricas y acciones */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Total Clientes Activos
          </div>
          <div className="mt-1 text-2xl font-black text-slate-900">{clientes.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Clientes con Saldo Deudor
          </div>
          <div className="mt-1 text-2xl font-black text-amber-600">
            {clientesConDeudaCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Deuda Total en Cta. Cte.
          </div>
          <div className="mt-1 text-2xl font-black text-rose-600">
            {formatearPesos(totalDeudaGeneral.toFixed(2))}
          </div>
        </div>
      </div>

      {/* Barra de búsqueda y controles */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Buscar por nombre, CUIT/DNI o código (ej: CLI-001)..."
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
              }}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => {
                  setBusqueda('');
                }}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={soloConDeuda}
              onChange={(e) => {
                setSoloConDeuda(e.target.checked);
              }}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Solo con deuda
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void cargarClientes();
            }}
            className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            ↻ Actualizar
          </button>
          <button
            type="button"
            data-testid="btn-nuevo-cliente"
            onClick={abrirModalNuevo}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
          >
            + Nuevo Cliente
          </button>
        </div>
      </div>

      {/* Tabla de Clientes */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Cliente / Razón Social</th>
                <th className="px-4 py-3">CUIT / DNI</th>
                <th className="px-4 py-3">Condición IVA</th>
                <th className="px-4 py-3">Lista Precio</th>
                <th className="px-4 py-3 text-right">Límite Crédito</th>
                <th className="px-4 py-3 text-right">Saldo Deudor</th>
                <th className="px-4 py-3 text-right">Crédito Disp.</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Cargando clientes...
                  </td>
                </tr>
              ) : clientes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No se encontraron clientes registrados.
                  </td>
                </tr>
              ) : (
                clientes.map((c) => {
                  const tieneDeuda = (parseFloat(c.saldoDeudor) || 0) > 0;
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 transition"
                      data-testid={`fila-cliente-${c.codigo}`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-slate-900">
                        {c.codigo}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{c.nombre}</div>
                        {c.telefono && (
                          <div className="text-xs text-slate-400">Tel: {c.telefono}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{c.cuitDni || '—'}</td>
                      <td className="px-4 py-3 text-xs capitalize">
                        {c.condicionIva.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                        {c.listaPrecioNombre ?? 'Mostrador'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {parseFloat(c.limiteCredito) > 0
                          ? formatearPesos(c.limiteCredito)
                          : 'Sin límite'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono font-bold ${
                            tieneDeuda ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {formatearPesos(c.saldoDeudor)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.excedidoLimite ? (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                            Excedido
                          </span>
                        ) : parseFloat(c.limiteCredito) > 0 ? (
                          <span className="font-mono text-xs text-slate-600">
                            {formatearPesos(c.creditoDisponible)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Ilimitado</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              void abrirFichaCliente(c);
                            }}
                            data-testid={`btn-ver-cta-${c.codigo}`}
                            className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                            title="Ver extracto y personas autorizadas"
                          >
                            Cta. Cte.
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              prepararCobro(c);
                            }}
                            data-testid={`btn-cobrar-${c.codigo}`}
                            disabled={!tieneDeuda}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                              tieneDeuda
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                            title="Cobrar en turno de caja"
                          >
                            Cobrar
                          </button>
                          {(rolUsuario === 'encargado' || rolUsuario === 'dueno') && (
                            <button
                              type="button"
                              onClick={() => {
                                abrirModalEditar(c);
                              }}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                              title="Editar cliente"
                            >
                              ✎
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel / Ficha de Cliente y Extracto de Cta. Cte. */}
      {clienteSeleccionado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          data-testid="modal-ficha-cliente"
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            {/* Header del modal */}
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-indigo-100 px-2 py-0.5 font-mono text-xs font-bold text-indigo-800">
                    {clienteSeleccionado.codigo}
                  </span>
                  <h3 className="text-xl font-black text-slate-900">
                    {clienteSeleccionado.nombre}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>CUIT/DNI: {clienteSeleccionado.cuitDni || 'Consumidor Final'}</span>
                  <span>IVA: {clienteSeleccionado.condicionIva.replace('_', ' ')}</span>
                  <span>Tel: {clienteSeleccionado.telefono || 'Sin teléfono'}</span>
                  <span>Dir: {clienteSeleccionado.direccion || 'Sin dirección'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setClienteSeleccionado(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Tarjetas de saldo del cliente */}
            <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50 p-4 sm:grid-cols-4">
              <div>
                <div className="text-xs font-bold text-slate-500">Límite de Crédito</div>
                <div className="text-base font-black text-slate-800">
                  {parseFloat(clienteSeleccionado.limiteCredito) > 0
                    ? formatearPesos(clienteSeleccionado.limiteCredito)
                    : 'Sin límite'}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">Total Compras (Débitos)</div>
                <div className="text-base font-black text-slate-800">
                  {formatearPesos(clienteSeleccionado.totalDebitos)}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">Total Pagos (Créditos)</div>
                <div className="text-base font-black text-emerald-600">
                  {formatearPesos(clienteSeleccionado.totalCreditos)}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">Saldo Deudor Actual</div>
                <div className="text-lg font-black text-rose-600">
                  {formatearPesos(saldoDeudorDetalle)}
                </div>
              </div>
            </div>

            {/* Pestañas internas de la ficha */}
            <div className="flex border-b border-slate-200 px-5 pt-3">
              <button
                type="button"
                onClick={() => {
                  setTabFicha('movimientos');
                }}
                className={`pb-2.5 text-sm font-bold border-b-2 transition mr-6 ${
                  tabFicha === 'movimientos'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Extracto de Cuenta Corriente ({movimientosCtaCte.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTabFicha('autorizados');
                }}
                className={`pb-2.5 text-sm font-bold border-b-2 transition ${
                  tabFicha === 'autorizados'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Personas Autorizadas a Retirar ({autorizados.length})
              </button>
            </div>

            {/* Contenido de la pestaña */}
            <div className="flex-1 overflow-y-auto p-5">
              {cargandoDetalle ? (
                <div className="py-8 text-center text-slate-400">Cargando detalles...</div>
              ) : tabFicha === 'movimientos' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500 uppercase">
                      Historial inmutable de débitos y créditos
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          prepararCobro(clienteSeleccionado);
                        }}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                      >
                        + Cobrar a Cuenta
                      </button>
                      {(rolUsuario === 'encargado' || rolUsuario === 'dueno') && (
                        <button
                          type="button"
                          onClick={() => {
                            setAjusteTipo('ajuste_debito');
                            setAjusteMonto('0.00');
                            setAjusteDescripcion('');
                            setModalAjusteAbierto(true);
                          }}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          ± Ajuste Manual
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 font-bold uppercase text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2.5">Fecha</th>
                          <th className="px-3 py-2.5">Tipo</th>
                          <th className="px-3 py-2.5">Descripción / Comprobante</th>
                          <th className="px-3 py-2.5">Retiró</th>
                          <th className="px-3 py-2.5 text-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {movimientosCtaCte.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-slate-400 font-sans">
                              Sin movimientos registrados en cuenta corriente.
                            </td>
                          </tr>
                        ) : (
                          movimientosCtaCte.map((m) => {
                            const esDebito = m.sentido === 'debito';
                            return (
                              <tr key={m.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-500">
                                  {new Date(m.creadoEn).toLocaleString('es-AR', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </td>
                                <td className="px-3 py-2 font-sans font-bold capitalize">
                                  {m.tipo.replace('_', ' ')}
                                </td>
                                <td className="px-3 py-2 font-sans text-slate-700">
                                  {m.descripcion || '—'}
                                </td>
                                <td className="px-3 py-2 font-sans text-slate-700">
                                  {m.autorizadoNombre ? (
                                    <span>
                                      {m.autorizadoNombre}
                                      {m.autorizadoDni && ` (DNI ${m.autorizadoDni})`}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">Titular</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-bold">
                                  <span
                                    className={
                                      esDebito ? 'text-rose-600' : 'text-emerald-600'
                                    }
                                  >
                                    {esDebito ? '+ ' : '- '}
                                    {formatearPesos(m.monto)}
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
              ) : (
                <div className="space-y-5">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <h4 className="text-sm font-bold text-indigo-950 mb-3">
                      Habilitar persona para retirar mercadería a nombre de este cliente
                    </h4>
                    <form
                      onSubmit={(e) => {
                        void registrarAutorizado(e);
                      }}
                      className="grid grid-cols-1 gap-3 sm:grid-cols-4"
                    >
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          Nombre completo *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Ej: Juan Pérez"
                          value={autNombre}
                          onChange={(e) => {
                            setAutNombre(e.target.value);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          DNI / Documento
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: 34567890"
                          value={autDni}
                          onChange={(e) => {
                            setAutDni(e.target.value);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          Rol / Parentesco
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: Capataz / Albañil / Chofer"
                          value={autRol}
                          onChange={(e) => {
                            setAutRol(e.target.value);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <label className="block text-xs font-bold text-slate-600 mb-1">
                            Teléfono
                          </label>
                          <input
                            type="text"
                            placeholder="Opcional"
                            value={autTelefono}
                            onChange={(e) => {
                              setAutTelefono(e.target.value);
                            }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={guardandoAutorizado}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 shadow"
                        >
                          {guardandoAutorizado ? '...' : '+ Agregar'}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 font-bold uppercase text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2.5">Nombre</th>
                          <th className="px-3 py-2.5">DNI</th>
                          <th className="px-3 py-2.5">Rol / Parentesco</th>
                          <th className="px-3 py-2.5">Teléfono</th>
                          <th className="px-3 py-2.5 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {autorizados.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                              No hay personas autorizadas cargadas. Solo el titular puede retirar.
                            </td>
                          </tr>
                        ) : (
                          autorizados.map((a) => (
                            <tr key={a.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-bold text-slate-900">{a.nombre}</td>
                              <td className="px-3 py-2 font-mono">{a.dni || '—'}</td>
                              <td className="px-3 py-2">{a.rolParentesco || 'Autorizado'}</td>
                              <td className="px-3 py-2">{a.telefono || '—'}</td>
                              <td className="px-3 py-2 text-center">
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                  Habilitado
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 p-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setClienteSeleccionado(null);
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuevo / Editar Cliente */}
      {modalClienteAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          data-testid="modal-guardar-cliente"
        >
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900 mb-4">
              {clienteEnEdicion ? 'Editar Cliente' : 'Nuevo Cliente'}
            </h3>
            <form
              onSubmit={(e) => {
                void guardarCliente(e);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Código (opcional, auto: CLI-xxx)
                  </label>
                  <input
                    type="text"
                    placeholder="CLI-001"
                    value={formCodigo}
                    onChange={(e) => {
                      setFormCodigo(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Nombre o Razón Social *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Construcciones Martínez SRL"
                    value={formNombre}
                    onChange={(e) => {
                      setFormNombre(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    CUIT / DNI
                  </label>
                  <input
                    type="text"
                    placeholder="20-12345678-9"
                    value={formCuitDni}
                    onChange={(e) => {
                      setFormCuitDni(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Condición ante el IVA
                  </label>
                  <select
                    value={formCondicionIva}
                    onChange={(e) => {
                      setFormCondicionIva(e.target.value as CondicionIva);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="consumidor_final">Consumidor Final</option>
                    <option value="responsable_inscripto">Responsable Inscripto</option>
                    <option value="monotributo">Monotributo</option>
                    <option value="exento">Exento</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Teléfono
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 11-4567-8900"
                    value={formTelefono}
                    onChange={(e) => {
                      setFormTelefono(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="correo@ejemplo.com"
                    value={formEmail}
                    onChange={(e) => {
                      setFormEmail(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Dirección
                </label>
                <input
                  type="text"
                  placeholder="Calle y número, localidad"
                  value={formDireccion}
                  onChange={(e) => {
                    setFormDireccion(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Lista de Precios
                  </label>
                  <select
                    value={formListaPrecioId}
                    onChange={(e) => {
                      setFormListaPrecioId(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    {listasPrecios.map((lp) => (
                      <option key={lp.id} value={lp.id}>
                        {lp.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Límite Crédito ($)
                  </label>
                  <input
                    type="text"
                    placeholder="0.00 = Sin límite"
                    value={formLimiteCredito}
                    onChange={(e) => {
                      setFormLimiteCredito(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Días Plazo
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={formDiasPlazoCredito}
                    onChange={(e) => {
                      setFormDiasPlazoCredito(Number(e.target.value) || 0);
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Notas internas
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles sobre obras, transportes o referencias..."
                  value={formNotas}
                  onChange={(e) => {
                    setFormNotas(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalClienteAbierto(false);
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoCliente}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 shadow"
                >
                  {guardandoCliente ? 'Guardando...' : 'Guardar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cobranza de Cuenta Corriente */}
      {modalCobranzaAbierto && clienteParaCobro && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          data-testid="modal-cobranza-cta-cte"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900 mb-2">
              Cobranza a Cuenta Corriente
            </h3>
            <div className="rounded-xl bg-slate-50 p-3 mb-4 text-xs text-slate-600">
              <div>
                Cliente: <strong>{clienteParaCobro.codigo} · {clienteParaCobro.nombre}</strong>
              </div>
              <div>
                Saldo deudor actual:{' '}
                <strong className="text-rose-600 font-mono">
                  {formatearPesos(clienteParaCobro.saldoDeudor)}
                </strong>
              </div>
              {!turnoAbiertoId && (
                <div className="mt-2 font-bold text-amber-700">
                  ⚠️ No hay un turno de caja abierto. Debe abrir turno para cobrar.
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                void registrarCobro(e);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Monto a Cobrar ($) *
                </label>
                <input
                  type="text"
                  required
                  value={cobranzaMonto}
                  onChange={(e) => {
                    setCobranzaMonto(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-lg font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Medio de Cobro *
                </label>
                <select
                  value={cobranzaMedioPagoId}
                  onChange={(e) => {
                    setCobranzaMedioPagoId(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {mediosPago
                    .filter((m) => !m.nombre.toLowerCase().includes('corriente'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre} {m.esEfectivo ? '(Caja física)' : '(Bancos/Digital)'}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Descripción o Concepto
                </label>
                <input
                  type="text"
                  value={cobranzaDescripcion}
                  onChange={(e) => {
                    setCobranzaDescripcion(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalCobranzaAbierto(false);
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoCobro || !turnoAbiertoId}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 shadow disabled:bg-slate-300"
                >
                  {guardandoCobro ? 'Ingresando a caja...' : 'Confirmar Cobro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Ajuste Manual de Cuenta Corriente */}
      {modalAjusteAbierto && clienteSeleccionado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          data-testid="modal-ajuste-cta-cte"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900 mb-2">
              Ajuste Manual de Cuenta Corriente
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Los ajustes son auditados y quedan registrados en el extracto inmutable.
            </p>
            <form
              onSubmit={(e) => {
                void registrarAjuste(e);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Sentido del Ajuste
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAjusteTipo('ajuste_debito');
                    }}
                    className={`rounded-xl border-2 py-2 text-xs font-bold transition ${
                      ajusteTipo === 'ajuste_debito'
                        ? 'border-rose-500 bg-rose-50 text-rose-900'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Débito (+ Deuda)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAjusteTipo('ajuste_credito');
                    }}
                    className={`rounded-xl border-2 py-2 text-xs font-bold transition ${
                      ajusteTipo === 'ajuste_credito'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Crédito (- Deuda)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Monto ($) *
                </label>
                <input
                  type="text"
                  required
                  value={ajusteMonto}
                  onChange={(e) => {
                    setAjusteMonto(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-lg font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Motivo obligatorio *
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Ej: Corrección por devolución de mercadería según nota de crédito interna..."
                  value={ajusteDescripcion}
                  onChange={(e) => {
                    setAjusteDescripcion(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalAjusteAbierto(false);
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoAjuste}
                  className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white hover:bg-black shadow"
                >
                  {guardandoAjuste ? 'Guardando...' : 'Aplicar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
