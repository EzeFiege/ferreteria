import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  CrearListaPrecioInput,
  CrearReglaVolumenInput,
  FijarPrecioProductoListaInput,
  ReglaDescuentoVolumenItem,
  RolUsuario,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos, type ListaPrecioItem } from './App.js';

export interface GestionListasYReglasProps {
  token: string;
  rolActivo: RolUsuario;
  rubros: Array<{ id: string; nombre: string }>;
  onListasActualizadas?: () => void;
}

interface ProductoBusquedaItem {
  id: string;
  codigo: string;
  nombre: string;
  costoBase: string;
  unidadPrincipal: string;
}

export function GestionListasYReglas({
  token,
  rolActivo,
  rubros,
  onListasActualizadas,
}: GestionListasYReglasProps): ReactElement {
  // Pestaña interna: 'listas' | 'reglas' | 'precios_fijos'
  const [subTab, setSubTab] = useState<'listas' | 'reglas' | 'precios_fijos'>('listas');

  // Listas de precios
  const [listas, setListas] = useState<ListaPrecioItem[]>([]);
  const [cargandoListas, setCargandoListas] = useState<boolean>(false);
  const [nombreNuevaLista, setNombreNuevaLista] = useState<string>('');
  const [margenNuevaLista, setMargenNuevaLista] = useState<string>('30.00');
  const [ordenNuevaLista, setOrdenNuevaLista] = useState<number>(3);

  // Reglas de volumen
  const [reglas, setReglas] = useState<ReglaDescuentoVolumenItem[]>([]);
  const [cargandoReglas, setCargandoReglas] = useState<boolean>(false);
  const [nombreRegla, setNombreRegla] = useState<string>('');
  const [alcanceRegla, setAlcanceRegla] = useState<'producto' | 'rubro'>('rubro');
  const [productoReglaId, setProductoReglaId] = useState<string>('');
  const [rubroReglaId, setRubroReglaId] = useState<string>('');
  const [listaPrecioReglaId, setListaPrecioReglaId] = useState<string>('');
  const [cantidadMinimaRegla, setCantidadMinimaRegla] = useState<string>('10.000');
  const [descuentoPctRegla, setDescuentoPctRegla] = useState<string>('10.00');

  // Precios fijos por producto
  const [busquedaProdFijo, setBusquedaProdFijo] = useState<string>('');
  const [productosEncontrados, setProductosEncontrados] = useState<ProductoBusquedaItem[]>([]);
  const [prodFijoSeleccionado, setProdFijoSeleccionado] = useState<ProductoBusquedaItem | null>(null);
  const [listaPrecioFijoId, setListaPrecioFijoId] = useState<string>('');
  const [montoPrecioFijo, setMontoPrecioFijo] = useState<string>('');

  // Notificaciones
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<boolean>(false);

  const esDueno = rolActivo === 'dueno';

  // 1. Cargar listas de precios
  const cargarListas = useCallback(async () => {
    setCargandoListas(true);
    try {
      const res = await fetch(apiUrl('/api/listas-precios'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ListaPrecioItem[];
        setListas(data);
        if (data.length > 0 && !listaPrecioReglaId && data[0]) {
          setListaPrecioFijoId(data[0].id);
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setCargandoListas(false);
    }
  }, [listaPrecioReglaId, token]);

  // 2. Cargar reglas de volumen
  const cargarReglas = useCallback(async () => {
    setCargandoReglas(true);
    try {
      const res = await fetch(apiUrl('/api/reglas-volumen'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ReglaDescuentoVolumenItem[];
        setReglas(data);
      }
    } catch {
      // Offline fallback
    } finally {
      setCargandoReglas(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarListas();
    void cargarReglas();
  }, [cargarListas, cargarReglas]);

  // Crear nueva lista de precios
  const guardarNuevaLista = async () => {
    if (!nombreNuevaLista.trim()) {
      setErrorMsg('El nombre de la lista es obligatorio');
      return;
    }
    setGuardando(true);
    setErrorMsg(null);
    try {
      const payload: CrearListaPrecioInput = {
        nombre: nombreNuevaLista.trim(),
        margenPct: margenNuevaLista,
        orden: ordenNuevaLista,
        activo: true,
      };
      const res = await fetch(apiUrl('/api/listas-precios'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al crear lista de precios');
      }
      setMensaje(`Lista "${nombreNuevaLista.trim()}" creada con éxito.`);
      setNombreNuevaLista('');
      void cargarListas();
      if (onListasActualizadas) onListasActualizadas();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  };

  // Eliminar lista de precios
  const eliminarLista = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar la lista de precios "${nombre}"?`)) return;
    setGuardando(true);
    setErrorMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/listas-precios/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al eliminar lista');
      }
      setMensaje(`Lista "${nombre}" eliminada.`);
      void cargarListas();
      if (onListasActualizadas) onListasActualizadas();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  };

  // Crear regla de volumen
  const guardarNuevaRegla = async () => {
    if (!nombreRegla.trim()) {
      setErrorMsg('El nombre de la regla es obligatorio');
      return;
    }
    if (alcanceRegla === 'rubro' && !rubroReglaId) {
      setErrorMsg('Seleccione un rubro para la regla');
      return;
    }
    if (alcanceRegla === 'producto' && !productoReglaId) {
      setErrorMsg('Seleccione o ingrese un producto para la regla');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      const payload: CrearReglaVolumenInput = {
        nombre: nombreRegla.trim(),
        productoId: alcanceRegla === 'producto' ? productoReglaId : null,
        rubroId: alcanceRegla === 'rubro' ? rubroReglaId : null,
        listaPrecioId: listaPrecioReglaId ? listaPrecioReglaId : null,
        cantidadMinima: cantidadMinimaRegla,
        descuentoPct: descuentoPctRegla,
        activo: true,
      };

      const res = await fetch(apiUrl('/api/reglas-volumen'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al guardar regla de volumen');
      }

      setMensaje(`Regla de descuento "${nombreRegla.trim()}" guardada con éxito.`);
      setNombreRegla('');
      void cargarReglas();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  };

  // Activar / Desactivar regla
  const alternarReglaActiva = async (regla: ReglaDescuentoVolumenItem) => {
    try {
      const res = await fetch(apiUrl(`/api/reglas-volumen/${regla.id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ activo: !regla.activo }),
      });
      if (res.ok) {
        void cargarReglas();
      }
    } catch {
      // Ignorar fallo offline
    }
  };

  // Eliminar regla
  const eliminarRegla = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar la regla "${nombre}"?`)) return;
    try {
      const res = await fetch(apiUrl(`/api/reglas-volumen/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMensaje(`Regla "${nombre}" eliminada.`);
        void cargarReglas();
      }
    } catch {
      // Ignorar fallo offline
    }
  };

  // Buscar producto para fijar precio o regla
  const buscarProductos = async (termino: string) => {
    setBusquedaProdFijo(termino);
    if (termino.trim().length < 2) {
      setProductosEncontrados([]);
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/productos?q=${encodeURIComponent(termino)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ProductoBusquedaItem[];
        setProductosEncontrados(data.slice(0, 8));
      }
    } catch {
      // Ignorar
    }
  };

  // Guardar precio fijo
  const guardarPrecioFijo = async () => {
    if (!prodFijoSeleccionado) {
      setErrorMsg('Seleccione un producto del catálogo');
      return;
    }
    if (!listaPrecioFijoId) {
      setErrorMsg('Seleccione una lista de precios');
      return;
    }
    if (!montoPrecioFijo || parseFloat(montoPrecioFijo) < 0) {
      setErrorMsg('Ingrese un importe de precio fijo válido');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      const payload: FijarPrecioProductoListaInput = {
        productoId: prodFijoSeleccionado.id,
        listaPrecioId: listaPrecioFijoId,
        precioFijo: montoPrecioFijo,
      };

      const res = await fetch(apiUrl('/api/listas-precios/fijar-precio'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al fijar precio');
      }

      setMensaje(`Precio fijo de ${formatearPesos(montoPrecioFijo)} guardado para ${prodFijoSeleccionado.nombre}.`);
      setProdFijoSeleccionado(null);
      setMontoPrecioFijo('');
      setBusquedaProdFijo('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Selector de sub-pestaña */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setSubTab('listas'); }}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              subTab === 'listas'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📋 Listas de Precios ({listas.length})
          </button>
          <button
            type="button"
            onClick={() => { setSubTab('reglas'); }}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              subTab === 'reglas'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🏷️ Descuentos por Volumen ({reglas.length})
          </button>
          <button
            type="button"
            onClick={() => { setSubTab('precios_fijos'); }}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              subTab === 'precios_fijos'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🎯 Precios Fijos por Lista
          </button>
        </div>
      </div>

      {/* Alertas */}
      {mensaje && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-bold text-emerald-900">
          <span>{mensaje}</span>
          <button type="button" onClick={() => { setMensaje(null); }} className="text-emerald-700 font-black">
            ✕
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-bold text-rose-900">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => { setErrorMsg(null); }} className="text-rose-700 font-black">
            ✕
          </button>
        </div>
      )}

      {/* 1. SUBTAB LISTAS DE PRECIOS */}
      {subTab === 'listas' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Formulario Nueva Lista */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
            <h4 className="font-bold text-slate-900 text-sm">
              + Nueva Lista de Precios
            </h4>
            <p className="text-xs text-slate-500">
              Crea listas diferenciadas como Gremio, Mayorista o Especial Obras con su margen sobre el costo.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">Nombre</label>
                <input
                  type="text"
                  placeholder="Ej: Mayorista, Obras, Distribuidor"
                  value={nombreNuevaLista}
                  onChange={(e) => { setNombreNuevaLista(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Margen %</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="30.00"
                    value={margenNuevaLista}
                    onChange={(e) => { setMargenNuevaLista(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Orden</label>
                  <input
                    type="number"
                    min="1"
                    value={ordenNuevaLista}
                    onChange={(e) => { setOrdenNuevaLista(parseInt(e.target.value, 10) || 1); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={guardando || !esDueno}
                onClick={() => { void guardarNuevaLista(); }}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800 disabled:opacity-50 transition"
              >
                {guardando ? 'Guardando...' : '+ Crear Lista de Precios'}
              </button>
              {!esDueno && (
                <p className="text-[10px] text-amber-600">Requiere rol Dueño para crear listas.</p>
              )}
            </div>
          </div>

          {/* Listado de Listas */}
          <div className="md:col-span-2 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
            <h4 className="font-bold text-slate-900 text-sm mb-4">
              Listas de Precios Activas ({listas.length})
            </h4>

            {cargandoListas ? (
              <div className="p-8 text-center text-xs text-slate-400">Cargando listas...</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {listas.map((lp) => (
                  <div key={lp.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{lp.nombre}</span>
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-extrabold text-xs">
                          +{lp.margenPct}% margen
                        </span>
                        {lp.nombre.toLowerCase() === 'mostrador' && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                            Base
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Orden de visualización: #{lp.orden}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {lp.nombre.toLowerCase() !== 'mostrador' && esDueno && (
                        <button
                          type="button"
                          onClick={() => { void eliminarLista(lp.id, lp.nombre); }}
                          className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. SUBTAB REGLAS DE VOLUMEN */}
      {subTab === 'reglas' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Formulario Nueva Regla */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
            <h4 className="font-bold text-slate-900 text-sm">
              + Nueva Regla por Volumen
            </h4>
            <p className="text-xs text-slate-500">
              Aplica bonificaciones porcentuales automáticas en caja cuando el cliente compra en cantidad.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">Nombre / Motivo</label>
                <input
                  type="text"
                  placeholder="Ej: Promo 10+ Tornillos, Bulto Pinturas"
                  value={nombreRegla}
                  onChange={(e) => { setNombreRegla(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">Alcance de la Regla</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setAlcanceRegla('rubro'); }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition ${
                      alcanceRegla === 'rubro'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Por Rubro Completo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAlcanceRegla('producto'); }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition ${
                      alcanceRegla === 'producto'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Por Producto Específico
                  </button>
                </div>
              </div>

              {alcanceRegla === 'rubro' ? (
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Rubro</label>
                  <select
                    value={rubroReglaId}
                    onChange={(e) => { setRubroReglaId(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">-- Seleccionar Rubro --</option>
                    {rubros.map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Buscar Producto</label>
                  <input
                    type="text"
                    placeholder="Escribir nombre o código..."
                    value={busquedaProdFijo}
                    onChange={(e) => { void buscarProductos(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                  {productosEncontrados.length > 0 && (
                    <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                      {productosEncontrados.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProductoReglaId(p.id);
                            setBusquedaProdFijo(`${p.codigo} - ${p.nombre}`);
                            setProductosEncontrados([]);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between"
                        >
                          <span className="font-bold text-slate-800">{p.nombre}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{p.codigo}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  Lista de Precios Aplicable (Opcional)
                </label>
                <select
                  value={listaPrecioReglaId}
                  onChange={(e) => { setListaPrecioReglaId(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white focus:border-slate-900 focus:outline-none"
                >
                  <option value="">-- Aplica a Todas las Listas --</option>
                  {listas.map((lp) => (
                    <option key={lp.id} value={lp.id}>{lp.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Cant. Mínima</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={cantidadMinimaRegla}
                    onChange={(e) => { setCantidadMinimaRegla(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Descuento %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={descuentoPctRegla}
                    onChange={(e) => { setDescuentoPctRegla(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={guardando}
                onClick={() => { void guardarNuevaRegla(); }}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800 disabled:opacity-50 transition"
              >
                {guardando ? 'Guardando...' : '+ Crear Regla de Volumen'}
              </button>
            </div>
          </div>

          {/* Listado de Reglas */}
          <div className="md:col-span-2 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
            <h4 className="font-bold text-slate-900 text-sm mb-4">
              Reglas de Descuento Configuradas ({reglas.length})
            </h4>

            {cargandoReglas ? (
              <div className="p-8 text-center text-xs text-slate-400">Cargando reglas...</div>
            ) : reglas.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No hay reglas de volumen definidas aún. Crea una para automatizar promociones por cantidad.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {reglas.map((r) => (
                  <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{r.nombre}</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-extrabold text-xs">
                          -{r.descuentoPct}% OFF
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-bold">
                          Desde {parseFloat(r.cantidadMinima)} un.
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {r.productoNombre ? (
                          <span>Artículo: <strong>{r.productoNombre}</strong> ({r.productoCodigo})</span>
                        ) : (
                          <span>Rubro: <strong>{r.rubroNombre}</strong></span>
                        )}
                        {r.listaPrecioNombre && (
                          <span> · Exclusivo lista: <strong>{r.listaPrecioNombre}</strong></span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => { void alternarReglaActiva(r); }}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                          r.activo
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                        }`}
                      >
                        {r.activo ? '✓ Activa' : 'Pausada'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void eliminarRegla(r.id, r.nombre); }}
                        className="text-xs text-rose-600 hover:text-rose-800 font-bold"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. SUBTAB PRECIOS FIJOS */}
      {subTab === 'precios_fijos' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 max-w-2xl mx-auto space-y-4">
          <h4 className="font-bold text-slate-900 text-base">
            Fijar Precio Manual Excepcional por Producto
          </h4>
          <p className="text-xs text-slate-500">
            Sobreescribe el cálculo dinámico de margen para un producto en una lista de precios determinada.
          </p>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Buscar Producto</label>
              <input
                type="text"
                placeholder="Buscar por código, descripción o marca..."
                value={busquedaProdFijo}
                onChange={(e) => { void buscarProductos(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
              {productosEncontrados.length > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                  {productosEncontrados.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProdFijoSeleccionado(p);
                        setBusquedaProdFijo(`${p.codigo} - ${p.nombre}`);
                        setProductosEncontrados([]);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-bold text-slate-800">{p.nombre}</div>
                        <div className="text-[10px] text-slate-400">Costo Base: {formatearPesos(p.costoBase)}</div>
                      </div>
                      <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                        {p.codigo}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {prodFijoSeleccionado && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
                Seleccionado: <strong>{prodFijoSeleccionado.nombre}</strong> (Costo base: {formatearPesos(prodFijoSeleccionado.costoBase)})
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Lista de Precios</label>
                <select
                  value={listaPrecioFijoId}
                  onChange={(e) => { setListaPrecioFijoId(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white focus:border-slate-900 focus:outline-none"
                >
                  {listas.map((lp) => (
                    <option key={lp.id} value={lp.id}>
                      {lp.nombre} (+{lp.margenPct}%)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Precio Fijo Final ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ej: 1450.00"
                  value={montoPrecioFijo}
                  onChange={(e) => { setMontoPrecioFijo(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={guardando || !prodFijoSeleccionado}
              onClick={() => { void guardarPrecioFijo(); }}
              className="w-full rounded-xl bg-slate-900 py-3 text-xs font-bold text-white shadow hover:bg-slate-800 disabled:opacity-50 transition"
            >
              {guardando ? 'Guardando...' : 'Guardar Precio Fijo Excepcional'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
