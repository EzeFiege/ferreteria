import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import type {
  ClienteContactoBitacoraItem,
  ClienteObraItem,
  CrearBitacoraContactoInput,
  CrearClienteObraInput,
  EtapaPresupuestoCrm,
  PresupuestoKanbanItem,
  RolUsuario,
  SegmentacionClienteItem,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

export interface CrmGestionProps {
  token: string;
  rolUsuario: RolUsuario;
  onCargarPresupuestoEnMostrador?: (presupuestoId: string) => void;
}

interface ClienteBusqueda {
  id: string;
  nombre: string;
  telefono: string | null;
  cuitDni: string | null;
}

const ETAPAS_KANBAN: Array<{
  id: EtapaPresupuestoCrm;
  titulo: string;
  colorBorder: string;
  colorBg: string;
  icono: string;
}> = [
  { id: 'borrador', titulo: 'Borrador', colorBorder: 'border-slate-300', colorBg: 'bg-slate-50', icono: '📝' },
  { id: 'enviado', titulo: 'Enviado', colorBorder: 'border-blue-300', colorBg: 'bg-blue-50/50', icono: '✉️' },
  { id: 'negociacion', titulo: 'En Negociación', colorBorder: 'border-amber-300', colorBg: 'bg-amber-50/50', icono: '💬' },
  { id: 'ganado', titulo: 'Ganado (Aprobado)', colorBorder: 'border-emerald-300', colorBg: 'bg-emerald-50/50', icono: '🏆' },
  { id: 'perdido', titulo: 'Perdido', colorBorder: 'border-rose-300', colorBg: 'bg-rose-50/50', icono: '❌' },
];

export function CrmGestion({
  token,
  rolUsuario: _rolUsuario,
  onCargarPresupuestoEnMostrador,
}: CrmGestionProps): ReactElement {
  const [tabActiva, setTabActiva] = useState<'pipeline' | 'obras' | 'bitacora' | 'segmentacion'>('pipeline');

  // Estados de Pipeline Kanban
  const [presupuestos, setPresupuestos] = useState<PresupuestoKanbanItem[]>([]);
  const [cargandoPipeline, setCargandoPipeline] = useState<boolean>(false);

  // Estados de Obras
  const [obras, setObras] = useState<ClienteObraItem[]>([]);
  const [cargandoObras, setCargandoObras] = useState<boolean>(false);
  const [filtroObraEstado, setFiltroObraEstado] = useState<string>('todos');
  const [busquedaObra, setBusquedaObra] = useState<string>('');

  // Estados de Bitácora
  const [bitacora, setBitacora] = useState<ClienteContactoBitacoraItem[]>([]);
  const [cargandoBitacora, setCargandoBitacora] = useState<boolean>(false);
  const [filtroTipoBitacora, setFiltroTipoBitacora] = useState<string>('todos');

  // Estados de Segmentación
  const [segmentacion, setSegmentacion] = useState<SegmentacionClienteItem[]>([]);
  const [cargandoSegmentacion, setCargandoSegmentacion] = useState<boolean>(false);
  const [filtroRfm, setFiltroRfm] = useState<string>('todos');

  // Notificaciones y clientes para selector
  const [clientes, setClientes] = useState<ClienteBusqueda[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modales
  const [modalNuevaObra, setModalNuevaObra] = useState<boolean>(false);
  const [obraAEditar, setObraAEditar] = useState<ClienteObraItem | null>(null);
  const [modalBitacora, setModalBitacora] = useState<boolean>(false);

  // Formulario Nueva/Editar Obra
  const [formObraClienteId, setFormObraClienteId] = useState<string>('');
  const [formObraNombre, setFormObraNombre] = useState<string>('');
  const [formObraDireccion, setFormObraDireccion] = useState<string>('');
  const [formObraLocalidad, setFormObraLocalidad] = useState<string>('');
  const [formObraContacto, setFormObraContacto] = useState<string>('');
  const [formObraTelefono, setFormObraTelefono] = useState<string>('');
  const [formObraFechaInicio, setFormObraFechaInicio] = useState<string>('');
  const [formObraFechaFin, setFormObraFechaFin] = useState<string>('');
  const [formObraEstado, setFormObraEstado] = useState<'planificacion' | 'activa' | 'pausada' | 'finalizada'>('activa');
  const [formObraPresupuesto, setFormObraPresupuesto] = useState<string>('0.00');
  const [formObraNotas, setFormObraNotas] = useState<string>('');
  const [guardandoObra, setGuardandoObra] = useState<boolean>(false);

  // Formulario Bitácora
  const [formBitacoraClienteId, setFormBitacoraClienteId] = useState<string>('');
  const [formBitacoraObraId, setFormBitacoraObraId] = useState<string>('');
  const [formBitacoraTipo, setFormBitacoraTipo] = useState<'llamada' | 'whatsapp' | 'visita_obra' | 'reunion' | 'nota'>('llamada');
  const [formBitacoraDesc, setFormBitacoraDesc] = useState<string>('');
  const [formBitacoraProxFec, setFormBitacoraProxFec] = useState<string>('');
  const [formBitacoraProxAcc, setFormBitacoraProxAcc] = useState<string>('');
  const [guardandoBitacora, setGuardandoBitacora] = useState<boolean>(false);

  // Modal Motivo Perdido Kanban
  const [modalPerdidoId, setModalPerdidoId] = useState<string | null>(null);
  const [motivoPerdidoTexto, setMotivoPerdidoTexto] = useState<string>('');

  // Cargar Clientes
  const cargarClientes = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/clientes'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ClienteBusqueda[];
        setClientes(data);
      }
    } catch {
      // Ignora
    }
  }, [token]);

  // Cargar Pipeline
  const cargarPipeline = useCallback(async () => {
    setCargandoPipeline(true);
    try {
      const res = await fetch(apiUrl('/crm/pipeline'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as PresupuestoKanbanItem[];
        setPresupuestos(data);
      }
    } catch {
      setErrorMsg('No se pudo cargar el pipeline de presupuestos');
    } finally {
      setCargandoPipeline(false);
    }
  }, [token]);

  // Cargar Obras
  const cargarObras = useCallback(async () => {
    setCargandoObras(true);
    try {
      let url = apiUrl('/crm/obras');
      const params = new URLSearchParams();
      if (filtroObraEstado !== 'todos') params.append('estado', filtroObraEstado);
      if (busquedaObra.trim()) params.append('q', busquedaObra.trim());
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ClienteObraItem[];
        setObras(data);
      }
    } catch {
      setErrorMsg('No se pudieron cargar las obras');
    } finally {
      setCargandoObras(false);
    }
  }, [token, filtroObraEstado, busquedaObra]);

  // Cargar Bitácora
  const cargarBitacora = useCallback(async () => {
    setCargandoBitacora(true);
    try {
      const res = await fetch(apiUrl('/crm/bitacora?limite=100'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ClienteContactoBitacoraItem[];
        setBitacora(data);
      }
    } catch {
      setErrorMsg('No se pudo cargar la bitácora de contacto');
    } finally {
      setCargandoBitacora(false);
    }
  }, [token]);

  // Cargar Segmentación
  const cargarSegmentacion = useCallback(async () => {
    setCargandoSegmentacion(true);
    try {
      const res = await fetch(apiUrl('/crm/segmentacion'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as SegmentacionClienteItem[];
        setSegmentacion(data);
      }
    } catch {
      setErrorMsg('No se pudo cargar la segmentación de clientes');
    } finally {
      setCargandoSegmentacion(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarClientes();
  }, [cargarClientes]);

  useEffect(() => {
    if (tabActiva === 'pipeline') void cargarPipeline();
    if (tabActiva === 'obras') void cargarObras();
    if (tabActiva === 'bitacora') void cargarBitacora();
    if (tabActiva === 'segmentacion') void cargarSegmentacion();
  }, [tabActiva, cargarPipeline, cargarObras, cargarBitacora, cargarSegmentacion]);

  // Cambiar Etapa Kanban
  const handleCambiarEtapa = async (
    presupuestoId: string,
    nuevaEtapa: EtapaPresupuestoCrm,
    motivoPerdido?: string,
  ) => {
    try {
      const res = await fetch(apiUrl(`/crm/pipeline/${presupuestoId}/etapa`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          etapaCrm: nuevaEtapa,
          motivoPerdido: motivoPerdido ?? null,
          probabilidadPct:
            nuevaEtapa === 'ganado'
              ? 100
              : nuevaEtapa === 'negociacion'
                ? 75
                : nuevaEtapa === 'enviado'
                  ? 50
                  : nuevaEtapa === 'borrador'
                    ? 25
                    : 0,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al actualizar etapa');
      }

      setAviso(`Presupuesto actualizado a "${nuevaEtapa}"`);
      void cargarPipeline();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      setErrorMsg(msg);
    }
  };

  // Guardar Obra (Crear o Editar)
  const handleGuardarObra = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!formObraNombre.trim()) {
      setErrorMsg('El nombre de la obra es requerido');
      return;
    }
    if (!obraAEditar && !formObraClienteId) {
      setErrorMsg('Debe seleccionar un cliente para la obra');
      return;
    }

    setGuardandoObra(true);
    try {
      const url = obraAEditar
        ? apiUrl(`/crm/obras/${obraAEditar.id}`)
        : apiUrl('/crm/obras');
      const method = obraAEditar ? 'PATCH' : 'POST';

      const payload: CrearClienteObraInput = {
        clienteId: formObraClienteId,
        nombre: formObraNombre.trim(),
        direccion: formObraDireccion.trim() || undefined,
        localidad: formObraLocalidad.trim() || undefined,
        contactoResponsable: formObraContacto.trim() || undefined,
        telefonoResponsable: formObraTelefono.trim() || undefined,
        fechaInicio: formObraFechaInicio || undefined,
        fechaFinEstimada: formObraFechaFin || undefined,
        estado: formObraEstado,
        presupuestoEstimado: formObraPresupuesto.trim() || '0.00',
        notas: formObraNotas.trim() || undefined,
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al guardar la obra');
      }

      setAviso(obraAEditar ? 'Obra actualizada con éxito' : 'Nueva obra registrada con éxito');
      setModalNuevaObra(false);
      setObraAEditar(null);
      void cargarObras();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      setErrorMsg(msg);
    } finally {
      setGuardandoObra(false);
    }
  };

  const abrirEditarObra = (obra: ClienteObraItem) => {
    setObraAEditar(obra);
    setFormObraClienteId(obra.clienteId);
    setFormObraNombre(obra.nombre);
    setFormObraDireccion(obra.direccion ?? '');
    setFormObraLocalidad(obra.localidad ?? '');
    setFormObraContacto(obra.contactoResponsable ?? '');
    setFormObraTelefono(obra.telefonoResponsable ?? '');
    setFormObraFechaInicio(obra.fechaInicio ?? '');
    setFormObraFechaFin(obra.fechaFinEstimada ?? '');
    setFormObraEstado(obra.estado);
    setFormObraPresupuesto(obra.presupuestoEstimado);
    setFormObraNotas(obra.notas ?? '');
    setModalNuevaObra(true);
  };

  const abrirCrearObra = () => {
    setObraAEditar(null);
    setFormObraClienteId(clientes[0]?.id ?? '');
    setFormObraNombre('');
    setFormObraDireccion('');
    setFormObraLocalidad('');
    setFormObraContacto('');
    setFormObraTelefono('');
    setFormObraFechaInicio('');
    setFormObraFechaFin('');
    setFormObraEstado('activa');
    setFormObraPresupuesto('0.00');
    setFormObraNotas('');
    setModalNuevaObra(true);
  };

  // Guardar Bitácora
  const handleGuardarBitacora = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!formBitacoraClienteId) {
      setErrorMsg('Debe seleccionar un cliente');
      return;
    }
    if (!formBitacoraDesc.trim()) {
      setErrorMsg('La descripción del contacto o tarea es requerida');
      return;
    }

    setGuardandoBitacora(true);
    try {
      const payload: CrearBitacoraContactoInput = {
        clienteId: formBitacoraClienteId,
        obraId: formBitacoraObraId || undefined,
        tipo: formBitacoraTipo,
        descripcion: formBitacoraDesc.trim(),
        proximoContactoFecha: formBitacoraProxFec || undefined,
        proximoContactoAccion: formBitacoraProxAcc.trim() || undefined,
      };

      const res = await fetch(apiUrl('/crm/bitacora'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al registrar contacto');
      }

      setAviso('Nota registrada en la bitácora');
      setModalBitacora(false);
      setFormBitacoraDesc('');
      setFormBitacoraProxFec('');
      setFormBitacoraProxAcc('');
      void cargarBitacora();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      setErrorMsg(msg);
    } finally {
      setGuardandoBitacora(false);
    }
  };

  const abrirNuevaBitacora = (cliId?: string, obId?: string) => {
    setFormBitacoraClienteId(cliId ?? clientes[0]?.id ?? '');
    setFormBitacoraObraId(obId ?? '');
    setFormBitacoraTipo('llamada');
    setFormBitacoraDesc('');
    setFormBitacoraProxFec('');
    setFormBitacoraProxAcc('');
    setModalBitacora(true);
  };

  return (
    <div className="space-y-6">
      {/* Cabecera Principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏗️</span>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">
              CRM Comercial 360° & Obras
            </h1>
            <span className="rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-bold px-2.5 py-0.5">
              ERP Ferretería
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gestión integral de obras, pipeline de presupuestos, bitácora de seguimiento comercial y segmentación de clientes.
          </p>
        </div>

        {/* Botones de acción rápida */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={abrirCrearObra}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-500 transition"
          >
            <span>+</span>
            <span>Nueva Obra</span>
          </button>
          <button
            type="button"
            onClick={() => { abrirNuevaBitacora(); }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            <span>📞</span>
            <span>Registrar Contacto</span>
          </button>
        </div>
      </div>

      {/* Avisos y Alertas */}
      {aviso && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 flex items-center justify-between">
          <span>{aviso}</span>
          <button type="button" onClick={() => { setAviso(null); }} className="text-emerald-600 hover:text-emerald-900">
            ✕
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-bold text-rose-800 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => { setErrorMsg(null); }} className="text-rose-600 hover:text-rose-900">
            ✕
          </button>
        </div>
      )}

      {/* Navegación por pestañas */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => { setTabActiva('pipeline'); }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
            tabActiva === 'pipeline'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>📊</span>
          <span>Pipeline de Presupuestos (Kanban)</span>
          <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px]">
            {presupuestos.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setTabActiva('obras'); }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
            tabActiva === 'obras'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🏗️</span>
          <span>Obras & Proyectos</span>
          <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px]">
            {obras.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setTabActiva('bitacora'); }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
            tabActiva === 'bitacora'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>📞</span>
          <span>Bitácora de Contacto</span>
          <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px]">
            {bitacora.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setTabActiva('segmentacion'); }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
            tabActiva === 'segmentacion'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🌟</span>
          <span>Segmentación RFM</span>
        </button>
      </div>

      {/* TAB 1: PIPELINE KANBAN */}
      {tabActiva === 'pipeline' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Visualizá el ciclo de cierre de presupuestos y cotizaciones para no perder operaciones.</span>
            <button
              type="button"
              onClick={() => { void cargarPipeline(); }}
              className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
            >
              <span>🔄</span>
              <span>Actualizar Pipeline</span>
            </button>
          </div>

          {cargandoPipeline ? (
            <div className="py-12 text-center text-xs font-semibold text-slate-400">
              Cargando tarjetas del pipeline comercial...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5 items-start">
              {ETAPAS_KANBAN.map((col) => {
                const tarjetasCol = presupuestos.filter((p) => p.etapaCrm === col.id);
                const totalCol = tarjetasCol.reduce((acc, t) => acc + parseFloat(t.total || '0'), 0);

                return (
                  <div
                    key={col.id}
                    className={`rounded-xl border ${col.colorBorder} ${col.colorBg} p-3 flex flex-col gap-2.5 min-h-[500px]`}
                  >
                    {/* Encabezado Columna */}
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                        <span>{col.icono}</span>
                        <span>{col.titulo}</span>
                      </div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-600 shadow-xs border border-slate-200">
                        {tarjetasCol.length}
                      </span>
                    </div>

                    <div className="text-[11px] font-bold text-slate-500 text-right">
                      {formatearPesos(totalCol.toFixed(2))}
                    </div>

                    {/* Tarjetas */}
                    <div className="space-y-2.5 overflow-y-auto max-h-[650px] pr-0.5">
                      {tarjetasCol.length === 0 ? (
                        <div className="py-6 text-center text-[11px] text-slate-400 italic">
                          Sin cotizaciones
                        </div>
                      ) : (
                        tarjetasCol.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-lg bg-white p-3 shadow-xs border border-slate-200 hover:border-indigo-400 transition space-y-2 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-black text-indigo-700 text-xs">
                                Presupuesto #{String(item.numero).padStart(6, '0')}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(item.fechaEmision).toLocaleDateString('es-AR')}
                              </span>
                            </div>

                            <div className="font-bold text-slate-800 truncate" title={item.clienteNombre ?? 'Consumidor Final'}>
                              👤 {item.clienteNombre ?? 'Consumidor Final'}
                            </div>

                            {item.obraNombre && (
                              <div className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800 truncate">
                                🏗️ {item.obraNombre}
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                              <span className="text-slate-500 text-[11px]">Total:</span>
                              <span className="font-extrabold text-slate-900 text-xs">
                                {formatearPesos(item.total)}
                              </span>
                            </div>

                            {item.motivoPerdido && (
                              <div className="rounded bg-rose-50 p-1 text-[10px] text-rose-800 font-medium">
                                <strong>Motivo:</strong> {item.motivoPerdido}
                              </div>
                            )}

                            {/* Controles de avance rápido */}
                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[10px]">
                              {col.id !== 'borrador' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const prevIdx = ETAPAS_KANBAN.findIndex((e) => e.id === col.id) - 1;
                                    const prevEtapa = ETAPAS_KANBAN[prevIdx]?.id ?? 'borrador';
                                    void handleCambiarEtapa(item.id, prevEtapa);
                                  }}
                                  className="text-slate-400 hover:text-slate-700 font-bold px-1"
                                  title="Retroceder etapa"
                                >
                                  ◀
                                </button>
                              )}

                              <select
                                value={item.etapaCrm}
                                onChange={(e) => {
                                  const val = e.target.value as EtapaPresupuestoCrm;
                                  if (val === 'perdido') {
                                    setModalPerdidoId(item.id);
                                  } else {
                                    void handleCambiarEtapa(item.id, val);
                                  }
                                }}
                                className="flex-1 rounded border border-slate-200 bg-slate-50 py-1 px-1.5 text-[10px] font-semibold text-slate-700"
                              >
                                {ETAPAS_KANBAN.map((et) => (
                                  <option key={et.id} value={et.id}>
                                    {et.titulo}
                                  </option>
                                ))}
                              </select>

                              {col.id !== 'ganado' && col.id !== 'perdido' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextIdx = ETAPAS_KANBAN.findIndex((e) => e.id === col.id) + 1;
                                    const nextEtapa = ETAPAS_KANBAN[nextIdx]?.id ?? 'ganado';
                                    void handleCambiarEtapa(item.id, nextEtapa);
                                  }}
                                  className="text-indigo-600 hover:text-indigo-800 font-bold px-1"
                                  title="Avanzar etapa"
                                >
                                  ▶
                                </button>
                              )}
                            </div>

                            {/* Acciones extra: Cargar en caja si está ganado */}
                            {col.id === 'ganado' && onCargarPresupuestoEnMostrador && (
                              <button
                                type="button"
                                onClick={() => { onCargarPresupuestoEnMostrador(item.id); }}
                                className="w-full mt-1 flex items-center justify-center gap-1 rounded bg-emerald-600 py-1 text-[10px] font-bold text-white hover:bg-emerald-500 transition"
                              >
                                <span>🛒</span>
                                <span>Cargar en Mostrador</span>
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: OBRAS & PROYECTOS */}
      {tabActiva === 'obras' && (
        <div className="space-y-4">
          {/* Barra de Filtros */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 w-full md:w-auto">
              <input
                type="text"
                placeholder="Buscar por obra, cliente o dirección..."
                value={busquedaObra}
                onChange={(e) => { setBusquedaObra(e.target.value); }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs w-full md:w-80"
              />
              <select
                value={filtroObraEstado}
                onChange={(e) => { setFiltroObraEstado(e.target.value); }}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
              >
                <option value="todos">Todos los estados</option>
                <option value="activa">Activa</option>
                <option value="planificacion">En Planificación</option>
                <option value="pausada">Pausada</option>
                <option value="finalizada">Finalizada</option>
              </select>
            </div>

            <button
              type="button"
              onClick={abrirCrearObra}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 shadow-sm transition"
            >
              + Agregar Obra
            </button>
          </div>

          {cargandoObras ? (
            <div className="py-12 text-center text-xs font-semibold text-slate-400">
              Cargando obras y proyectos...
            </div>
          ) : obras.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
              No hay obras registradas con los filtros seleccionados.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {obras.map((obra) => {
                const consumido = parseFloat(obra.totalVentasAsociadas || '0');
                const presupuestoEst = parseFloat(obra.presupuestoEstimado || '0');
                const pct = presupuestoEst > 0 ? Math.min(100, Math.round((consumido / presupuestoEst) * 100)) : 0;

                const colorEstado =
                  obra.estado === 'activa'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : obra.estado === 'planificacion'
                      ? 'bg-blue-100 text-blue-800 border-blue-300'
                      : obra.estado === 'pausada'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-slate-100 text-slate-700 border-slate-300';

                return (
                  <div
                    key={obra.id}
                    className="rounded-xl bg-white p-4 border border-slate-200 shadow-xs flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-extrabold text-sm text-slate-900 leading-tight">
                          {obra.nombre}
                        </h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${colorEstado}`}>
                          {obra.estado}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-indigo-700 truncate">
                        👤 {obra.clienteNombre}
                      </div>

                      {obra.direccion && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <span>📍</span>
                          <span>{obra.direccion} {obra.localidad ? `(${obra.localidad})` : ''}</span>
                        </div>
                      )}

                      {obra.contactoResponsable && (
                        <div className="text-[11px] text-slate-600 flex items-center justify-between">
                          <span>👷 {obra.contactoResponsable}</span>
                          {obra.telefonoResponsable && (
                            <a
                              href={`https://wa.me/${obra.telefonoResponsable.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-600 hover:underline font-bold text-[10px]"
                            >
                              WhatsApp 💬
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Consumo y Presupuesto */}
                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/60 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Presupuesto Estimado:</span>
                        <strong className="text-slate-800">{formatearPesos(obra.presupuestoEstimado)}</strong>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Ventas Facturadas:</span>
                        <strong className="text-emerald-700">{formatearPesos(obra.totalVentasAsociadas)}</strong>
                      </div>

                      {presupuestoEst > 0 && (
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Avance de compras</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct > 90 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <button
                        type="button"
                        onClick={() => { abrirEditarObra(obra); }}
                        className="text-slate-500 hover:text-slate-800 font-bold"
                      >
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => { abrirNuevaBitacora(obra.clienteId, obra.id); }}
                        className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
                      >
                        <span>📞</span>
                        <span>Nota</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BITÁCORA DE SEGUIMIENTO */}
      {tabActiva === 'bitacora' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Filtrar por tipo:</span>
              <select
                value={filtroTipoBitacora}
                onChange={(e) => { setFiltroTipoBitacora(e.target.value); }}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
              >
                <option value="todos">Todos los contactos</option>
                <option value="llamada">📞 Llamadas</option>
                <option value="whatsapp">💬 WhatsApp</option>
                <option value="visita_obra">👷 Visitas a Obra</option>
                <option value="reunion">🤝 Reuniones</option>
                <option value="nota">📝 Notas Internas</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => { abrirNuevaBitacora(); }}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 shadow-sm transition"
            >
              + Nueva Entrada
            </button>
          </div>

          {cargandoBitacora ? (
            <div className="py-12 text-center text-xs font-semibold text-slate-400">
              Cargando historial de contactos...
            </div>
          ) : bitacora.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
              Aún no hay llamadas ni notas comerciales registradas.
            </div>
          ) : (
            <div className="space-y-3">
              {bitacora
                .filter((b) => filtroTipoBitacora === 'todos' || b.tipo === filtroTipoBitacora)
                .map((item) => {
                  const icono =
                    item.tipo === 'llamada'
                      ? '📞'
                      : item.tipo === 'whatsapp'
                        ? '💬'
                        : item.tipo === 'visita_obra'
                          ? '👷'
                          : item.tipo === 'reunion'
                            ? '🤝'
                            : '📝';

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl bg-white p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{icono}</span>
                          <span className="font-extrabold text-slate-800 text-sm">
                            {item.clienteNombre}
                          </span>
                          {item.obraNombre && (
                            <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                              🏗️ {item.obraNombre}
                            </span>
                          )}
                          {item.presupuestoNumero && (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                              Presupuesto #{String(item.presupuestoNumero).padStart(6, '0')}
                            </span>
                          )}
                        </div>

                        <p className="text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 whitespace-pre-wrap leading-relaxed">
                          {item.descripcion}
                        </p>

                        {(item.proximoContactoFecha || item.proximoContactoAccion) && (
                          <div className="flex items-center gap-2 rounded bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] text-amber-900 font-semibold">
                            <span>⏰ Próximo compromiso:</span>
                            {item.proximoContactoFecha && (
                              <span>Fecha: {item.proximoContactoFecha}</span>
                            )}
                            {item.proximoContactoAccion && (
                              <span>— {item.proximoContactoAccion}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="text-right text-[11px] text-slate-400 shrink-0">
                        <div>{new Date(item.creadoEn).toLocaleString('es-AR')}</div>
                        {item.registradoPor && (
                          <div className="text-slate-500 font-semibold mt-0.5">Por: {item.registradoPor}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SEGMENTACIÓN RFM & FIDELIZACIÓN */}
      {tabActiva === 'segmentacion' && (
        <div className="space-y-6">
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-center justify-between text-xs font-bold text-amber-800">
                <span>🌟 Clientes VIP</span>
                <span>{segmentacion.filter((c) => c.categoriaRfm === 'vip').length}</span>
              </div>
              <p className="text-[11px] text-amber-600 mt-1">Mayor volumen de compra en últimos 90 días (&gt; $500.000)</p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                <span>🔁 Frecuentes</span>
                <span>{segmentacion.filter((c) => c.categoriaRfm === 'frecuente').length}</span>
              </div>
              <p className="text-[11px] text-emerald-600 mt-1">Compras recurrentes continuas</p>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
              <div className="flex items-center justify-between text-xs font-bold text-rose-800">
                <span>⚠️ Riesgo Abandono</span>
                <span>{segmentacion.filter((c) => c.categoriaRfm === 'riesgo_abandono').length}</span>
              </div>
              <p className="text-[11px] text-rose-600 mt-1">&gt; 30 días sin registrar ventas en caja</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>💤 Inactivos</span>
                <span>{segmentacion.filter((c) => c.categoriaRfm === 'inactivo').length}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">&gt; 90 días o sin compras recientes</p>
            </div>
          </div>

          {/* Tabla de Segmentación */}
          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">
                Cartera de Clientes Clasificada
              </h3>
              <select
                value={filtroRfm}
                onChange={(e) => { setFiltroRfm(e.target.value); }}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
              >
                <option value="todos">Todos los segmentos</option>
                <option value="vip">🌟 VIP</option>
                <option value="frecuente">🔁 Frecuente</option>
                <option value="regular">Regular</option>
                <option value="riesgo_abandono">⚠️ Riesgo de Abandono</option>
                <option value="inactivo">💤 Inactivo</option>
              </select>
            </div>

            {cargandoSegmentacion ? (
              <div className="py-12 text-center text-xs text-slate-400">
                Analizando historial y volumen de compra...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Cliente</th>
                      <th className="py-2.5 px-3">Categoría</th>
                      <th className="py-2.5 px-3">Compras (90 días)</th>
                      <th className="py-2.5 px-3">Histórico Total</th>
                      <th className="py-2.5 px-3">Última Compra</th>
                      <th className="py-2.5 px-3">Saldo Cta. Cte.</th>
                      <th className="py-2.5 px-3 text-right">Acción Comercial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {segmentacion
                      .filter((c) => filtroRfm === 'todos' || c.categoriaRfm === filtroRfm)
                      .map((cli) => {
                        const badgeColor =
                          cli.categoriaRfm === 'vip'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : cli.categoriaRfm === 'frecuente'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : cli.categoriaRfm === 'riesgo_abandono'
                                ? 'bg-rose-100 text-rose-800 border-rose-300'
                                : 'bg-slate-100 text-slate-700 border-slate-300';

                        const mensajeWpp = encodeURIComponent(
                          `¡Hola ${cli.nombre}! Te escribimos de Ferretería Don Antonio para acercarte nuestras novedades, listas de precios especiales y consultar cómo venís con tus obras. ¿Hay algún material que necesites cotizar hoy?`,
                        );

                        return (
                          <tr key={cli.clienteId} className="hover:bg-slate-50/70 transition">
                            <td className="py-2.5 px-3">
                              <div className="font-extrabold text-slate-900">{cli.nombre}</div>
                              <div className="text-[10px] text-slate-400">Cód: {cli.codigo}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${badgeColor}`}>
                                {cli.categoriaRfm.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-slate-800">{formatearPesos(cli.totalComprasUltimos90Dias)}</div>
                              <div className="text-[10px] text-slate-400">{cli.cantidadComprasUltimos90Dias} compras</div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 font-semibold">
                              {formatearPesos(cli.totalComprasHistorico)}
                            </td>
                            <td className="py-2.5 px-3">
                              {cli.diasDesdeUltimaCompra !== null ? (
                                <span className={cli.diasDesdeUltimaCompra > 30 ? 'text-rose-600 font-bold' : 'text-slate-700'}>
                                  Hace {cli.diasDesdeUltimaCompra} días
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Sin registros</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={parseFloat(cli.saldoCtaCte) > 0 ? 'text-rose-600 font-bold' : 'text-slate-600'}>
                                {formatearPesos(cli.saldoCtaCte)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {cli.telefono ? (
                                <a
                                  href={`https://wa.me/${cli.telefono.replace(/\D/g, '')}?text=${mensajeWpp}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1 text-[11px] shadow-xs transition"
                                >
                                  <span>💬</span>
                                  <span>WhatsApp</span>
                                </a>
                              ) : (
                                <span className="text-slate-400 text-[10px]">Sin teléfono</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL NUEVA / EDITAR OBRA */}
      {modalNuevaObra && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-900">
                {obraAEditar ? 'Editar Obra' : 'Nueva Obra / Proyecto'}
              </h3>
              <button
                type="button"
                onClick={() => { setModalNuevaObra(false); }}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => { void handleGuardarObra(e); }} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Cliente Asociado *</label>
                <select
                  disabled={Boolean(obraAEditar)}
                  value={formObraClienteId}
                  onChange={(e) => { setFormObraClienteId(e.target.value); }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Nombre de la Obra *</label>
                <input
                  type="text"
                  placeholder="Ej: Edificio San Martín 1200 / Casa Quinta"
                  value={formObraNombre}
                  onChange={(e) => { setFormObraNombre(e.target.value); }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Dirección de Entrega</label>
                  <input
                    type="text"
                    placeholder="Calle y número"
                    value={formObraDireccion}
                    onChange={(e) => { setFormObraDireccion(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Localidad</label>
                  <input
                    type="text"
                    placeholder="Ciudad / Barrio"
                    value={formObraLocalidad}
                    onChange={(e) => { setFormObraLocalidad(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Capataz / Contacto</label>
                  <input
                    type="text"
                    placeholder="Nombre del responsable"
                    value={formObraContacto}
                    onChange={(e) => { setFormObraContacto(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Teléfono Obra</label>
                  <input
                    type="text"
                    placeholder="Ej: 1122334455"
                    value={formObraTelefono}
                    onChange={(e) => { setFormObraTelefono(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Estado</label>
                  <select
                    value={formObraEstado}
                    onChange={(e) => {
                      setFormObraEstado(e.target.value as 'planificacion' | 'activa' | 'pausada' | 'finalizada');
                    }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
                  >
                    <option value="activa">Activa</option>
                    <option value="planificacion">Planificación</option>
                    <option value="pausada">Pausada</option>
                    <option value="finalizada">Finalizada</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Inicio</label>
                  <input
                    type="date"
                    value={formObraFechaInicio}
                    onChange={(e) => { setFormObraFechaInicio(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fin Estimado</label>
                  <input
                    type="date"
                    value={formObraFechaFin}
                    onChange={(e) => { setFormObraFechaFin(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Presupuesto Estimado ($)</label>
                <input
                  type="text"
                  placeholder="0.00"
                  value={formObraPresupuesto}
                  onChange={(e) => { setFormObraPresupuesto(e.target.value); }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notas / Instrucciones de Entrega</label>
                <textarea
                  rows={2}
                  placeholder="Observaciones de acceso a la obra..."
                  value={formObraNotas}
                  onChange={(e) => { setFormObraNotas(e.target.value); }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setModalNuevaObra(false); }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoObra}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 font-bold text-white hover:bg-indigo-500 shadow"
                >
                  {guardandoObra ? 'Guardando...' : 'Guardar Obra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NUEVA ENTRADA BITÁCORA */}
      {modalBitacora && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-900">
                Registrar Contacto o Compromiso
              </h3>
              <button
                type="button"
                onClick={() => { setModalBitacora(false); }}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => { void handleGuardarBitacora(e); }} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Cliente *</label>
                <select
                  value={formBitacoraClienteId}
                  onChange={(e) => { setFormBitacoraClienteId(e.target.value); }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
                >
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Canal de Contacto</label>
                  <select
                    value={formBitacoraTipo}
                    onChange={(e) => {
                      setFormBitacoraTipo(
                        e.target.value as 'llamada' | 'whatsapp' | 'visita_obra' | 'reunion' | 'nota',
                      );
                    }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
                  >
                    <option value="llamada">📞 Llamada Telefónica</option>
                    <option value="whatsapp">💬 WhatsApp</option>
                    <option value="visita_obra">👷 Visita a Obra</option>
                    <option value="reunion">🤝 Reunión Comercial</option>
                    <option value="nota">📝 Nota Interna</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Obra (Opcional)</label>
                  <select
                    value={formBitacoraObraId}
                    onChange={(e) => { setFormBitacoraObraId(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  >
                    <option value="">Ninguna</option>
                    {obras
                      .filter((o) => !formBitacoraClienteId || o.clienteId === formBitacoraClienteId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nombre}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Detalle del Contacto o Conversación *</label>
                <textarea
                  rows={3}
                  placeholder="Detallar lo conversado, acuerdos de precio o necesidades de la obra..."
                  value={formBitacoraDesc}
                  onChange={(e) => { setFormBitacoraDesc(e.target.value); }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Próxima Fecha de Contacto</label>
                  <input
                    type="date"
                    value={formBitacoraProxFec}
                    onChange={(e) => { setFormBitacoraProxFec(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Acción a Realizar</label>
                  <input
                    type="text"
                    placeholder="Ej: Llamar por cotización"
                    value={formBitacoraProxAcc}
                    onChange={(e) => { setFormBitacoraProxAcc(e.target.value); }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setModalBitacora(false); }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoBitacora}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 font-bold text-white hover:bg-indigo-500 shadow"
                >
                  {guardandoBitacora ? 'Guardando...' : 'Guardar en Bitácora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MOTIVO PERDIDO */}
      {modalPerdidoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="font-black text-base text-slate-900">
              Registrar Motivo de Pérdida
            </h3>
            <p className="text-xs text-slate-500">
              Indicá por qué no se concretó la venta para enriquecer las métricas comerciales:
            </p>

            <select
              value={motivoPerdidoTexto}
              onChange={(e) => { setMotivoPerdidoTexto(e.target.value); }}
              className="w-full rounded-lg border border-slate-300 p-2 text-xs font-semibold"
            >
              <option value="">Seleccionar motivo...</option>
              <option value="Precio más alto que la competencia">Precio más alto que la competencia</option>
              <option value="Falta de stock disponible inmediato">Falta de stock disponible inmediato</option>
              <option value="Plazo de entrega logístico no conveniente">Plazo de entrega logístico no conveniente</option>
              <option value="El cliente suspendió o canceló la obra">El cliente suspendió o canceló la obra</option>
              <option value="Sin respuesta / desistió">Sin respuesta / desistió</option>
            </select>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setModalPerdidoId(null); }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (modalPerdidoId) {
                    void handleCambiarEtapa(modalPerdidoId, 'perdido', motivoPerdidoTexto || 'Sin motivo');
                    setModalPerdidoId(null);
                  }
                }}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500 shadow"
              >
                Confirmar Pérdida
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
