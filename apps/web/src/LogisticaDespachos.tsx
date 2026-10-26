import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  CrearDespachoEnvioInput,
  CrearHojaRutaInput,
  DespachoEnvioResumen,
  HojaRutaDetalleCompleto,
  RolUsuario,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

export interface LogisticaDespachosProps {
  token: string;
  rolUsuario: RolUsuario;
}

interface ClienteBusqueda {
  id: string;
  nombre: string;
  cuitDni: string | null;
  direccion: string | null;
  telefono: string | null;
}

interface HojaRutaListItem {
  id: string;
  numero: string;
  fechaSalida: string;
  fleteroNombre: string;
  fleteroTelefono: string | null;
  vehiculoPatente: string | null;
  estado: 'en_preparacion' | 'en_viaje' | 'finalizada' | 'cancelada';
  observaciones: string | null;
  totalParadas: number;
  paradasEntregadas: number;
}

export function LogisticaDespachos({
  token,
  rolUsuario: _rolUsuario,
}: LogisticaDespachosProps): ReactElement {
  const [seccion, setSeccion] = useState<'envios' | 'hojas_ruta'>('envios');

  // Envíos
  const [envios, setEnvios] = useState<DespachoEnvioResumen[]>([]);
  const [filtroEstadoEnvio, setFiltroEstadoEnvio] = useState<string>('todos');
  const [busquedaTexto, setBusquedaTexto] = useState<string>('');
  const [cargandoEnvios, setCargandoEnvios] = useState<boolean>(true);

  // Selección de envíos para armar hoja de ruta
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});

  // Hojas de Ruta
  const [hojasRuta, setHojasRuta] = useState<HojaRutaListItem[]>([]);
  const [hojaSeleccionadaId, setHojaSeleccionadaId] = useState<string | null>(null);
  const [detalleHoja, setDetalleHoja] = useState<HojaRutaDetalleCompleto | null>(null);
  const [cargandoHojas, setCargandoHojas] = useState<boolean>(false);

  // Feedback
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modal Nuevo Envío
  const [modalNuevoEnvio, setModalNuevoEnvio] = useState<boolean>(false);
  const [clienteId, setClienteId] = useState<string>('');
  const [clienteNombre, setClienteNombre] = useState<string>('');
  const [busquedaCliente, setBusquedaCliente] = useState<string>('');
  const [clientesSugeridos, setClientesSugeridos] = useState<ClienteBusqueda[]>([]);
  const [buscandoClientes, setBuscandoClientes] = useState<boolean>(false);
  const [direccionDestino, setDireccionDestino] = useState<string>('');
  const [localidad, setLocalidad] = useState<string>('');
  const [contactoNombre, setContactoNombre] = useState<string>('');
  const [contactoTelefono, setContactoTelefono] = useState<string>('');
  const [franjaHoraria, setFranjaHoraria] = useState<string>('Mañana 08:00 a 12:00');
  const [costoFlete, setCostoFlete] = useState<string>('0.00');
  const [notasDespacho, setNotasDespacho] = useState<string>('');

  // Modal Nueva Hoja de Ruta
  const [modalNuevaHoja, setModalNuevaHoja] = useState<boolean>(false);
  const [fleteroNombre, setFleteroNombre] = useState<string>('');
  const [fleteroTelefono, setFleteroTelefono] = useState<string>('');
  const [vehiculoPatente, setVehiculoPatente] = useState<string>('');
  const [observacionesHoja, setObservacionesHoja] = useState<string>('');

  // Cargar Envíos
  const cargarEnvios = useCallback(async () => {
    setCargandoEnvios(true);
    setErrorMsg(null);
    try {
      let url = apiUrl('/api/logistica/envios');
      if (filtroEstadoEnvio !== 'todos') {
        url += `?estado=${filtroEstadoEnvio}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al cargar despachos');
      const data = (await res.json()) as { envios: DespachoEnvioResumen[] };
      setEnvios(data.envios);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al cargar envíos');
    } finally {
      setCargandoEnvios(false);
    }
  }, [token, filtroEstadoEnvio]);

  // Cargar Hojas de Ruta
  const cargarHojasRuta = useCallback(async () => {
    setCargandoHojas(true);
    try {
      const res = await fetch(apiUrl('/api/logistica/hojas-ruta'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { hojasRuta: HojaRutaListItem[] };
        setHojasRuta(data.hojasRuta);
      }
    } catch {
      // Ignora
    } finally {
      setCargandoHojas(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarEnvios();
    void cargarHojasRuta();
  }, [cargarEnvios, cargarHojasRuta]);

  // Cargar detalle de Hoja de Ruta
  const cargarDetalleHoja = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(apiUrl(`/api/logistica/hojas-ruta/${id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as HojaRutaDetalleCompleto;
          setDetalleHoja(data);
        }
      } catch {
        // Ignora
      }
    },
    [token],
  );

  const seleccionarHoja = (id: string): void => {
    setHojaSeleccionadaId(id);
    void cargarDetalleHoja(id);
  };

  // Buscar clientes para nuevo envío
  useEffect(() => {
    if (!busquedaCliente.trim() || busquedaCliente.length < 2) {
      setClientesSugeridos([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setBuscandoClientes(true);
        try {
          const res = await fetch(
            apiUrl(`/api/clientes?q=${encodeURIComponent(busquedaCliente.trim())}`),
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.ok) {
            const data = (await res.json()) as { clientes: ClienteBusqueda[] };
            setClientesSugeridos(data.clientes);
          }
        } catch {
          // Ignora
        } finally {
          setBuscandoClientes(false);
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [busquedaCliente, token]);

  // Guardar Nuevo Envío
  const handleGuardarNuevoEnvio = async (): Promise<void> => {
    if (!clienteId) {
      setErrorMsg('Debes seleccionar un cliente.');
      return;
    }
    if (!direccionDestino.trim()) {
      setErrorMsg('La dirección de destino es obligatoria.');
      return;
    }
    if (!contactoNombre.trim()) {
      setErrorMsg('El nombre de quien recibe es obligatorio.');
      return;
    }

    try {
      const payload: CrearDespachoEnvioInput = {
        clienteId,
        direccionDestino: direccionDestino.trim(),
        localidad: localidad.trim() || undefined,
        contactoNombre: contactoNombre.trim(),
        contactoTelefono: contactoTelefono.trim() || undefined,
        franjaHoraria: franjaHoraria.trim() || undefined,
        costoFlete: costoFlete.trim() || '0.00',
        notasDespacho: notasDespacho.trim() || undefined,
      };

      const res = await fetch(apiUrl('/api/logistica/envios'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Error al registrar envío');
      }

      const resData = (await res.json()) as { numero: string };
      setAviso(`Envío ${resData.numero} registrado con éxito.`);
      setModalNuevoEnvio(false);
      setClienteId('');
      setClienteNombre('');
      setDireccionDestino('');
      setLocalidad('');
      setContactoNombre('');
      setContactoTelefono('');
      setNotasDespacho('');
      await cargarEnvios();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar envío');
    }
  };

  // Crear Hoja de Ruta con despachos seleccionados
  const handleCrearHojaRuta = async (): Promise<void> => {
    const despachosIds = Object.keys(seleccionados).filter((id) => seleccionados[id]);
    if (despachosIds.length === 0) {
      setErrorMsg('Selecciona al menos un envío para incluir en la hoja de ruta.');
      return;
    }
    if (!fleteroNombre.trim()) {
      setErrorMsg('Ingresa el nombre del fletero o chofer.');
      return;
    }

    try {
      const payload: CrearHojaRutaInput = {
        fleteroNombre: fleteroNombre.trim(),
        fleteroTelefono: fleteroTelefono.trim() || undefined,
        vehiculoPatente: vehiculoPatente.trim().toUpperCase() || undefined,
        observaciones: observacionesHoja.trim() || undefined,
        despachosIds,
      };

      const res = await fetch(apiUrl('/api/logistica/hojas-ruta'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Error al crear hoja de ruta');
      }

      const resData = (await res.json()) as { id: string; numero: string };
      setAviso(`Hoja de ruta ${resData.numero} generada con ${despachosIds.length} paradas.`);
      setModalNuevaHoja(false);
      setSeleccionados({});
      setFleteroNombre('');
      setFleteroTelefono('');
      setVehiculoPatente('');
      setObservacionesHoja('');
      await cargarEnvios();
      await cargarHojasRuta();
      setSeccion('hojas_ruta');
      seleccionarHoja(resData.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al crear hoja de ruta');
    }
  };

  // Registrar entrega de parada individual
  const handleActualizarParada = async (
    hojaId: string,
    paradaId: string,
    estadoParada: 'entregado' | 'no_entregado',
  ): Promise<void> => {
    try {
      const res = await fetch(apiUrl(`/api/logistica/hojas-ruta/${hojaId}/paradas/${paradaId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ estadoParada }),
      });

      if (!res.ok) throw new Error('Error al actualizar parada');

      await cargarDetalleHoja(hojaId);
      await cargarHojasRuta();
      await cargarEnvios();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al actualizar parada');
    }
  };

  // Imprimir Hoja de Ruta
  const handleImprimirHojaRuta = (): void => {
    window.print();
  };

  // Filtrado de envíos
  const enviosFiltrados = envios.filter((e) => {
    if (!busquedaTexto.trim()) return true;
    const txt = busquedaTexto.toLowerCase();
    return (
      e.numero.toLowerCase().includes(txt) ||
      e.clienteNombre.toLowerCase().includes(txt) ||
      e.direccionDestino.toLowerCase().includes(txt) ||
      (e.contactoTelefono && e.contactoTelefono.includes(txt))
    );
  });

  const totalPendientes = envios.filter((e) => e.estado === 'pendiente').length;
  const totalEnCamino = envios.filter((e) => e.estado === 'en_camino').length;
  const totalEntregados = envios.filter((e) => e.estado === 'entregado').length;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white font-black text-lg">
              🚚
            </span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Logística de Envíos y Hojas de Ruta
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gestión de despachos a domicilio, fletes y hojas de ruta para repartidores.
          </p>
        </div>

        {/* Selector de subsección y botón nuevo */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => { setSeccion('envios'); }}
              className={`rounded-lg px-3 py-1.5 transition ${
                seccion === 'envios'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📦 Envíos ({envios.length})
            </button>
            <button
              type="button"
              onClick={() => { setSeccion('hojas_ruta'); }}
              className={`rounded-lg px-3 py-1.5 transition ${
                seccion === 'hojas_ruta'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📋 Hojas de Ruta ({hojasRuta.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => { setModalNuevoEnvio(true); }}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition"
          >
            ➕ Nuevo Envío
          </button>
        </div>
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button type="button" onClick={() => { setErrorMsg(null); }} className="font-bold underline">
            ✕
          </button>
        </div>
      )}

      {aviso && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span>✅ {aviso}</span>
          <button type="button" onClick={() => { setAviso(null); }} className="font-bold underline">
            ✕
          </button>
        </div>
      )}

      {/* SUBSECCIÓN 1: ENVÍOS */}
      {seccion === 'envios' && (
        <div className="space-y-4">
          {/* Métricas rápidas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-bold uppercase text-slate-500">Pendientes</span>
              <div className="text-xl font-black text-amber-600 mt-0.5">{totalPendientes}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-bold uppercase text-slate-500">En Reparto</span>
              <div className="text-xl font-black text-blue-600 mt-0.5">{totalEnCamino}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-[11px] font-bold uppercase text-slate-500">Entregados</span>
              <div className="text-xl font-black text-emerald-600 mt-0.5">{totalEntregados}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase text-slate-500">Seleccionados</span>
                <div className="text-xl font-black text-purple-700 mt-0.5">
                  {Object.values(seleccionados).filter(Boolean).length}
                </div>
              </div>
              {Object.values(seleccionados).filter(Boolean).length > 0 && (
                <button
                  type="button"
                  onClick={() => { setModalNuevaHoja(true); }}
                  className="rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-purple-700"
                >
                  Armar Hoja
                </button>
              )}
            </div>
          </div>

          {/* Filtros y Buscador */}
          <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <input
              type="text"
              placeholder="Buscar por cliente, dirección o N° de envío..."
              value={busquedaTexto}
              onChange={(e) => { setBusquedaTexto(e.target.value); }}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />

            <select
              value={filtroEstadoEnvio}
              onChange={(e) => { setFiltroEstadoEnvio(e.target.value); }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none"
            >
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Solo Pendientes</option>
              <option value="en_camino">En Camino</option>
              <option value="entregado">Entregados</option>
              <option value="fallido">Fallidos</option>
            </select>
          </div>

          {/* Tabla de Envíos */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-800">
                <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-center w-10">Sel.</th>
                    <th className="p-3">N° Envío</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Destino / Localidad</th>
                    <th className="p-3">Receptor / Tel.</th>
                    <th className="p-3">Franja</th>
                    <th className="p-3 text-right">Flete</th>
                    <th className="p-3 text-center">Estado</th>
                    <th className="p-3">Hoja de Ruta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cargandoEnvios ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        Cargando envíos...
                      </td>
                    </tr>
                  ) : enviosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        No hay envíos registrados con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    enviosFiltrados.map((item) => {
                      const puedeSeleccionar = item.estado === 'pendiente' && !item.hojaRutaId;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/60">
                          <td className="p-3 text-center">
                            {puedeSeleccionar ? (
                              <input
                                type="checkbox"
                                checked={Boolean(seleccionados[item.id])}
                                onChange={(e) => { setSeleccionados((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.checked,
                                  })); }
                                }
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="p-3 font-mono font-black text-blue-900">{item.numero}</td>
                          <td className="p-3 font-bold text-slate-900">{item.clienteNombre}</td>
                          <td className="p-3">
                            <span className="block font-medium">{item.direccionDestino}</span>
                            {item.localidad && (
                              <span className="text-[10px] text-slate-400">{item.localidad}</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="block font-medium">{item.contactoNombre}</span>
                            <span className="text-[10px] text-slate-500">
                              {item.contactoTelefono ?? 'Sin tel.'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500">{item.franjaHoraria ?? '-'}</td>
                          <td className="p-3 text-right font-black text-slate-900">
                            {formatearPesos(item.costoFlete)}
                          </td>
                          <td className="p-3 text-center">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                item.estado === 'entregado'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : item.estado === 'en_camino'
                                  ? 'bg-blue-100 text-blue-800'
                                  : item.estado === 'fallido'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {item.estado.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="p-3">
                            {item.hojaRutaNumero ? (
                              <span className="font-mono text-xs font-bold text-purple-800">
                                {item.hojaRutaNumero} ({item.fleteroNombre})
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sin asignar</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBSECCIÓN 2: HOJAS DE RUTA */}
      {seccion === 'hojas_ruta' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Listado de Hojas (5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-slate-200">
              <span className="text-xs font-black uppercase text-slate-700">
                Hojas de Ruta ({hojasRuta.length})
              </span>
              <button
                type="button"
                onClick={() => void cargarHojasRuta()}
                className="text-xs text-blue-600 font-bold hover:underline"
              >
                Actualizar
              </button>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {cargandoHojas ? (
                <div className="p-8 text-center text-xs text-slate-400">Cargando hojas...</div>
              ) : hojasRuta.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 border border-dashed rounded-2xl bg-white">
                  No hay hojas de ruta generadas.
                </div>
              ) : (
                hojasRuta.map((hr) => {
                  const sel = hojaSeleccionadaId === hr.id;
                  const finalizada = hr.estado === 'finalizada';
                  return (
                    <div
                      key={hr.id}
                      onClick={() => { seleccionarHoja(hr.id); }}
                      className={`cursor-pointer rounded-2xl border p-4 transition shadow-xs ${
                        sel
                          ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-black text-blue-900">
                          {hr.numero}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            finalizada
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {hr.estado.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="mt-1 font-bold text-slate-900 text-sm">
                        {hr.fleteroNombre}
                      </div>
                      <div className="text-xs text-slate-500 flex gap-2 mt-0.5">
                        <span>Vehículo: {hr.vehiculoPatente ?? 'No informado'}</span>
                        <span>•</span>
                        <span>Fecha: {hr.fechaSalida}</span>
                      </div>

                      <div className="mt-2 text-xs text-slate-600 flex justify-between items-center border-t border-slate-100 pt-2">
                        <span>
                          Paradas:{' '}
                          <strong className="text-emerald-700">{hr.paradasEntregadas}</strong> /{' '}
                          {hr.totalParadas} entregadas
                        </span>
                        <span className="text-[11px] font-bold text-blue-600">Ver paradas →</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Detalle de la Hoja de Ruta (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            {!hojaSeleccionadaId || !detalleHoja ? (
              <div className="p-12 text-center text-slate-400 border border-dashed rounded-3xl bg-white">
                <span className="text-4xl block mb-2">📋</span>
                <p className="font-bold text-slate-600 text-sm">Ninguna hoja de ruta seleccionada</p>
                <p className="text-xs mt-1">
                  Selecciona una hoja del panel izquierdo para consultar el orden de paradas y registrar entregas.
                </p>
              </div>
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5 print:shadow-none print:border-none">
                {/* Cabecera Hoja */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xl font-black text-blue-900">
                        {detalleHoja.numero}
                      </span>
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-bold uppercase bg-blue-100 text-blue-800">
                        {detalleHoja.estado.replace('_', ' ')}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-900 mt-1">
                      Fletero: {detalleHoja.fleteroNombre}
                    </h3>
                    <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
                      <span>Patente: {detalleHoja.vehiculoPatente ?? '-'}</span>
                      <span>•</span>
                      <span>Fecha de salida: {detalleHoja.fechaSalida}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleImprimirHojaRuta}
                      className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm"
                    >
                      🖨 Imprimir Hoja
                    </button>
                  </div>
                </div>

                {/* Paradas */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase text-slate-700">
                    Orden de Paradas ({detalleHoja.paradas.length})
                  </h4>

                  <div className="space-y-2">
                    {detalleHoja.paradas.map((p) => {
                      const entregado = p.estadoParada === 'entregado';
                      const fallido = p.estadoParada === 'no_entregado';

                      return (
                        <div
                          key={p.id}
                          className={`rounded-2xl border p-4 transition ${
                            entregado
                              ? 'border-emerald-200 bg-emerald-50/40'
                              : fallido
                              ? 'border-rose-200 bg-rose-50/40'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white font-black text-xs">
                                  {p.ordenParada}
                                </span>
                                <span className="font-mono text-xs font-bold text-blue-800">
                                  {p.despachoNumero}
                                </span>
                                <span className="font-bold text-slate-900 text-sm">
                                  {p.clienteNombre}
                                </span>
                              </div>

                              <div className="text-xs text-slate-600 mt-1.5 pl-8 space-y-0.5">
                                <div>
                                  📍 Dirección:{' '}
                                  <strong className="text-slate-900">{p.direccionDestino}</strong>
                                  {p.localidad ? ` (${p.localidad})` : ''}
                                </div>
                                <div>
                                  👤 Recibe: {p.contactoNombre}
                                  {p.contactoTelefono ? ` · Tel: ${p.contactoTelefono}` : ''}
                                </div>
                              </div>
                            </div>

                            {/* Acciones de parada */}
                            <div className="flex flex-col sm:flex-row gap-1.5 print:hidden">
                              {p.estadoParada === 'pendiente' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleActualizarParada(detalleHoja.id, p.id, 'entregado')
                                    }
                                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                                  >
                                    ✓ Entregado
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleActualizarParada(
                                        detalleHoja.id,
                                        p.id,
                                        'no_entregado',
                                      )
                                    }
                                    className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 shadow-xs"
                                  >
                                    ✕ No Entregado
                                  </button>
                                </>
                              ) : (
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${
                                    entregado
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {p.estadoParada.replace('_', ' ')}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Casillero para firma al imprimir */}
                          <div className="hidden print:block mt-6 border-t border-dashed border-slate-300 pt-2 text-right">
                            <span className="text-[10px] text-slate-400">
                              Firma y aclaración del receptor: ____________________________
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL NUEVO DESPACHO */}
      {modalNuevoEnvio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-slate-900">Nuevo Envío a Domicilio</h3>
              <button
                type="button"
                onClick={() => { setModalNuevoEnvio(false); }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {/* Buscar cliente */}
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-slate-700">Cliente *</label>
              {clienteId ? (
                <div className="flex items-center justify-between rounded-xl bg-blue-50 p-2.5 border border-blue-200">
                  <span className="text-xs font-bold text-blue-900">{clienteNombre}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setClienteId('');
                      setClienteNombre('');
                    }}
                    className="text-xs text-rose-600 font-bold underline"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Escribe el nombre o CUIT del cliente..."
                    value={busquedaCliente}
                    onChange={(e) => { setBusquedaCliente(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                  {buscandoClientes && (
                    <span className="absolute right-3 top-2 text-xs text-slate-400">Buscando...</span>
                  )}
                  {clientesSugeridos.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                      {clientesSugeridos.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setClienteId(c.id);
                            setClienteNombre(c.nombre);
                            if (c.direccion) setDireccionDestino(c.direccion);
                            if (c.telefono) setContactoTelefono(c.telefono);
                            setContactoNombre(c.nombre);
                            setBusquedaCliente('');
                            setClientesSugeridos([]);
                          }}
                          className="cursor-pointer p-2.5 hover:bg-blue-50 text-xs border-b border-slate-100 flex justify-between"
                        >
                          <span className="font-bold text-slate-800">{c.nombre}</span>
                          <span className="text-slate-400">{c.cuitDni ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Dirección y Localidad */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">
                  Dirección de Entrega *
                </label>
                <input
                  type="text"
                  placeholder="Calle y número / Lote"
                  value={direccionDestino}
                  onChange={(e) => { setDireccionDestino(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">Localidad / Zona</label>
                <input
                  type="text"
                  placeholder="Ej: Zárate, Campana, Escobar"
                  value={localidad}
                  onChange={(e) => { setLocalidad(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Receptor y Teléfono */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">
                  Persona de Contacto *
                </label>
                <input
                  type="text"
                  placeholder="Nombre de quien recibe"
                  value={contactoNombre}
                  onChange={(e) => { setContactoNombre(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">Teléfono</label>
                <input
                  type="text"
                  placeholder="Celular para coordinar flete"
                  value={contactoTelefono}
                  onChange={(e) => { setContactoTelefono(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Franja horaria y Costo Flete */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">Franja Horaria</label>
                <select
                  value={franjaHoraria}
                  onChange={(e) => { setFranjaHoraria(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none"
                >
                  <option value="Mañana 08:00 a 12:00">Mañana (08:00 a 12:00)</option>
                  <option value="Tarde 13:00 a 17:00">Tarde (13:00 a 17:00)</option>
                  <option value="Todo el día">Todo el día</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">Costo Flete ($)</label>
                <input
                  type="number"
                  step="100"
                  value={costoFlete}
                  onChange={(e) => { setCostoFlete(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none text-right font-black"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-slate-700">Notas de Despacho</label>
              <input
                type="text"
                placeholder="Ej: Dejar descarga en planta baja, avisar 30m antes..."
                value={notasDespacho}
                onChange={(e) => { setNotasDespacho(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => { setModalNuevoEnvio(false); }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleGuardarNuevoEnvio()}
                className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
              >
                Guardar Envío
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CREAR HOJA DE RUTA */}
      {modalNuevaHoja && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-slate-900">Armar Hoja de Ruta</h3>
              <button
                type="button"
                onClick={() => { setModalNuevaHoja(false); }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-purple-50 p-3 text-xs text-purple-900 font-bold">
              Despachos seleccionados:{' '}
              {Object.values(seleccionados).filter(Boolean).length} envíos
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-slate-700">Nombre del Fletero *</label>
              <input
                type="text"
                placeholder="Chofer o fletero asignado"
                value={fleteroNombre}
                onChange={(e) => { setFleteroNombre(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none font-bold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">Teléfono Fletero</label>
                <input
                  type="text"
                  placeholder="Celular chofer"
                  value={fleteroTelefono}
                  onChange={(e) => { setFleteroTelefono(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">Patente Camión</label>
                <input
                  type="text"
                  placeholder="Ej: AB123CD"
                  value={vehiculoPatente}
                  onChange={(e) => { setVehiculoPatente(e.target.value.toUpperCase()); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none font-mono uppercase"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-slate-700">Observaciones del Viaje</label>
              <input
                type="text"
                placeholder="Ej: Reparto materiales pesados zona centro"
                value={observacionesHoja}
                onChange={(e) => { setObservacionesHoja(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => { setModalNuevaHoja(false); }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCrearHojaRuta()}
                className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-purple-700"
              >
                Generar Hoja de Ruta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
