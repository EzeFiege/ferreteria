import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { normalizarUrlImagen } from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';
import { ImportadorMasivoModal } from './ImportadorMasivoModal.js';
import { ActualizadorMasivoPrecios } from './ActualizadorMasivoPrecios.js';

interface ListaPrecioItem {
  id: string;
  nombre: string;
  margenPct: string;
  orden: number;
}

interface ProductoItem {
  id: string;
  codigo: string;
  sku: string | null;
  nombre: string;
  marca: string | null;
  descripcion: string | null;
  imagen_url: string | null;
  codigo_qr: string | null;
  costo_base: string;
  unidad_principal: string;
  unidad_secundaria: string | null;
  factor_conversion: string;
  permite_fraccion: boolean;
  stock_minimo: string;
  activo: boolean;
  rubro_id: string | null;
  rubro_nombre: string;
  stock_actual_base: string;
  precios: Record<string, string>;
}

interface LookupEanResponse {
  encontrado: boolean;
  origen: 'local' | 'mercadolibre' | 'catalogo_externo' | 'no_encontrado';
  codigoBarra: string;
  sku?: string;
  nombre?: string;
  marca?: string;
  imagenUrl?: string;
  rubroSugerido?: string;
  productoId?: string;
  codigo?: string;
  costoBase?: string;
  stockActualBase?: string;
  unidadPrincipal?: string;
  unidadSecundaria?: string;
  permiteFraccion?: boolean;
  precios?: Record<string, string>;
  candidatos?: Array<{
    nombre: string;
    marca?: string;
    rubro?: string;
    sku?: string;
    snippet?: string;
  }>;
}

export interface CatalogoStockProps {
  token: string;
  rolUsuario: 'cajero' | 'encargado' | 'dueno';
  rubros: Array<{ id: string; nombre: string }>;
}

export function CatalogoStock({
  token,
  rolUsuario,
  rubros,
}: CatalogoStockProps): ReactElement {
  const [productos, setProductos] = useState<ProductoItem[]>([]);
  const [listasPrecios, setListasPrecios] = useState<ListaPrecioItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [busqueda, setBusqueda] = useState<string>('');
  const [rubroFiltro, setRubroFiltro] = useState<string>('');
  const [aviso, setAviso] = useState<string | null>(null);

  // Escáner de pistola
  const [codigoPistolaInput, setCodigoPistolaInput] = useState<string>('');
  const [buscandoEan, setBuscandoEan] = useState<boolean>(false);
  const [buscandoEnModal, setBuscandoEnModal] = useState<boolean>(false);

  // Modales
  const [modalAltaAbierto, setModalAltaAbierto] = useState<boolean>(false);
  const [modalAjusteAbierto, setModalAjusteAbierto] = useState<boolean>(false);
  const [modalEtiquetaAbierto, setModalEtiquetaAbierto] = useState<boolean>(false);
  const [modalImportarAbierto, setModalImportarAbierto] = useState<boolean>(false);
  const [mostrarActualizadorPrecios, setMostrarActualizadorPrecios] = useState<boolean>(false);
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoItem | null>(null);

  // Formulario de Alta / Edición
  const [formId, setFormId] = useState<string | null>(null);
  const [formCodigo, setFormCodigo] = useState<string>('');
  const [formSku, setFormSku] = useState<string>('');
  const [formNombre, setFormNombre] = useState<string>('');
  const [formMarca, setFormMarca] = useState<string>('');
  const [formRubroId, setFormRubroId] = useState<string>('');
  const [formCostoBase, setFormCostoBase] = useState<string>('0.00');
  const [formUnidadPrincipal, setFormUnidadPrincipal] = useState<string>('un');
  const [formUnidadSecundaria, setFormUnidadSecundaria] = useState<string>('');
  const [formFactorConversion, setFormFactorConversion] = useState<string>('1.000');
  const [formPermiteFraccion, setFormPermiteFraccion] = useState<boolean>(false);
  const [formStockMinimo, setFormStockMinimo] = useState<string>('0.000');
  const [formCodigosBarra, setFormCodigosBarra] = useState<string>('');
  const [formImagenUrl, setFormImagenUrl] = useState<string>('');
  const [origenAutocompletado, setOrigenAutocompletado] = useState<string | null>(null);
  const [candidatosWeb, setCandidatosWeb] = useState<
    Array<{ nombre: string; marca?: string; rubro?: string; sku?: string; snippet?: string }>
  >([]);

  // Formulario de Ajuste de Stock
  const [ajusteTipo, setAjusteTipo] = useState<
    'ajuste_sobrante' | 'ajuste_faltante' | 'merma_rotura' | 'ingreso_compra'
  >('ajuste_sobrante');
  const [ajusteCantidad, setAjusteCantidad] = useState<string>('1.000');
  const [ajusteUnidad, setAjusteUnidad] = useState<'principal' | 'secundaria'>('principal');
  const [ajusteNotas, setAjusteNotas] = useState<string>('');

  const handleSubirArchivoImagen = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAviso('El archivo seleccionado debe ser una imagen (JPG, PNG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const dataUrl = loadEvent.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 800;
        let width = img.width;
        let height = img.height;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const optimized = canvas.toDataURL('image/jpeg', 0.82);
          setFormImagenUrl(optimized);
        } else {
          setFormImagenUrl(dataUrl);
        }
        setAviso('Foto cargada correctamente como modelo del producto.');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const cargarListasPrecios = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/listas-precios'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ListaPrecioItem[];
        setListasPrecios(data);
      }
    } catch {
      // Ignorar en offline
    }
  }, [token]);

  const cargarProductos = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (busqueda.trim()) params.append('q', busqueda.trim());
      if (rubroFiltro) params.append('rubroId', rubroFiltro);

      const res = await fetch(apiUrl(`/api/productos?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ProductoItem[];
        setProductos(data);
      }
    } catch {
      setAviso('Error al cargar catálogo de productos');
    } finally {
      setCargando(false);
    }
  }, [token, busqueda, rubroFiltro]);

  useEffect(() => {
    void cargarListasPrecios();
    void cargarProductos();
  }, [cargarListasPrecios, cargarProductos]);

  // Listener para pistola lectora de código de barras (HID keyboard buffer)
  useEffect(() => {
    let buffer = '';
    let ultimoTiempo = 0;

    const handleKeyDown = (e: KeyboardEvent): void => {
      // Si el foco está en un textarea o input de texto normal, no capturar
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        target.id !== 'pistola-input'
      ) {
        return;
      }

      const ahora = Date.now();
      if (ahora - ultimoTiempo > 100) {
        buffer = '';
      }
      ultimoTiempo = ahora;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          const eanCapturado = buffer;
          buffer = '';
          void procesarDisparoPistola(eanCapturado);
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const limpiarFormularioAlta = useCallback(() => {
    setFormId(null);
    setFormCodigo('');
    setFormSku('');
    setFormNombre('');
    setFormMarca('');
    setFormRubroId(rubros[0]?.id ?? '');
    setFormCostoBase('0.00');
    setFormUnidadPrincipal('un');
    setFormUnidadSecundaria('');
    setFormFactorConversion('1.000');
    setFormPermiteFraccion(false);
    setFormStockMinimo('0.000');
    setFormCodigosBarra('');
    setFormImagenUrl('');
    setOrigenAutocompletado(null);
    setCandidatosWeb([]);
  }, [rubros]);

  const procesarDisparoPistola = async (codigoEan: string): Promise<void> => {
    const codigoLimpio = codigoEan.trim();
    if (!codigoLimpio) return;
    setBuscandoEan(true);
    setCodigoPistolaInput('');

    try {
      const res = await fetch(
        apiUrl(`/api/productos/lookup-ean/${encodeURIComponent(codigoLimpio)}`),
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        },
      );

      if (!res.ok) {
        throw new Error('Error al consultar código');
      }

      const lookup = (await res.json()) as LookupEanResponse;

      if (lookup.encontrado && lookup.origen === 'local') {
        // Encontrado localmente: lo seleccionamos y filtramos
        setBusqueda(codigoLimpio);
        setAviso(
          `Producto localizado: ${lookup.nombre ?? ''} · Stock: ${lookup.stockActualBase ?? '0'} ${lookup.unidadPrincipal ?? 'un'}`,
        );
      } else if (lookup.origen === 'mercadolibre' || lookup.origen === 'catalogo_externo') {
        const origenNombre = lookup.origen === 'mercadolibre' ? 'Mercado Libre' : 'Búsqueda Web EAN';
        // Encontrado en internet: abrir modal de alta con autocompletado fresco
        abrirModalAltaConDatos({
          codigo: lookup.codigo ?? codigoLimpio,
          sku: lookup.sku ?? '',
          nombre: lookup.nombre ?? '',
          marca: lookup.marca ?? '',
          imagenUrl: lookup.imagenUrl ?? '',
          codigosBarra: codigoLimpio,
          origen: origenNombre,
          rubroSugerido: lookup.rubroSugerido,
          candidatos: lookup.candidatos ?? [],
        });
        setAviso(
          `⚡ ¡Código EAN detectado en ${origenNombre}! Datos autocompletados: "${lookup.nombre ?? ''}"`,
        );
      } else {
        // No encontrado ni local ni en fuentes externas: abrir modal limpio con el código asignado
        abrirModalAltaConDatos({
          codigo: codigoLimpio,
          sku: '',
          nombre: '',
          marca: '',
          imagenUrl: '',
          codigosBarra: codigoLimpio,
          origen: null,
          candidatos: [],
        });
        setAviso(`Código ${codigoLimpio} no registrado. Completá el alta del nuevo producto.`);
      }
    } catch {
      setAviso('Error al buscar código de barras.');
    } finally {
      setBuscandoEan(false);
    }
  };

  const consultarEanYAutocompletar = async (codigoABuscar: string): Promise<boolean> => {
    const limpio = codigoABuscar.trim();
    if (!limpio) return false;
    setBuscandoEnModal(true);

    try {
      const res = await fetch(
        apiUrl(`/api/productos/lookup-ean/${encodeURIComponent(limpio)}`),
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        },
      );

      if (!res.ok) {
        throw new Error('Error al consultar código');
      }

      const lookup = (await res.json()) as LookupEanResponse;

      if (lookup.encontrado) {
        setFormCodigo(limpio);
        setFormNombre(lookup.nombre ?? '');
        setFormMarca(lookup.marca ?? '');
        setFormSku(lookup.sku ?? '');
        setFormImagenUrl(lookup.imagenUrl ?? '');
        setFormCodigosBarra(limpio);
        setCandidatosWeb(lookup.candidatos ?? []);

        if (lookup.rubroSugerido && rubros.length > 0) {
          const sugeridoLower = lookup.rubroSugerido.toLowerCase();
          const rubroMatch = rubros.find(
            (r) =>
              sugeridoLower.includes(r.nombre.toLowerCase()) ||
              r.nombre.toLowerCase().includes(sugeridoLower),
          );
          if (rubroMatch) {
            setFormRubroId(rubroMatch.id);
          }
        }

        const fuente =
          lookup.origen === 'mercadolibre'
            ? 'Mercado Libre'
            : lookup.origen === 'catalogo_externo'
              ? 'Búsqueda Web EAN'
              : 'Base de Datos Local';

        setOrigenAutocompletado(fuente);
        setAviso(`⚡ ¡Producto encontrado en ${fuente}! Datos autocompletados.`);
        return true;
      } else {
        // Al buscar otro código no encontrado, limpiar los datos del artículo previo para evitar confusión
        setFormCodigo(limpio);
        setFormNombre('');
        setFormMarca('');
        setFormSku('');
        setFormImagenUrl('');
        setFormCodigosBarra(limpio);
        setOrigenAutocompletado(null);
        setCandidatosWeb([]);
        setAviso(
          `No se encontraron datos en internet para el código ${limpio}. Podés ingresar los datos manualmente.`,
        );
        return false;
      }
    } catch {
      setAviso('Error al buscar código en internet.');
      return false;
    } finally {
      setBuscandoEnModal(false);
    }
  };

  const abrirModalAltaConDatos = (datos: {
    codigo: string;
    sku?: string | undefined;
    nombre: string;
    marca: string;
    imagenUrl: string;
    codigosBarra: string;
    origen: string | null;
    rubroSugerido?: string | undefined;
    candidatos?: Array<{ nombre: string; marca?: string; rubro?: string; sku?: string; snippet?: string }>;
  }): void => {
    setFormId(null);
    setFormCodigo(datos.codigo);
    setFormSku(datos.sku ?? '');
    setFormNombre(datos.nombre);
    setFormMarca(datos.marca);
    let rubroIdInicial = rubros[0]?.id ?? '';
    if (datos.rubroSugerido && rubros.length > 0) {
      const sugeridoLower = datos.rubroSugerido.toLowerCase();
      const match = rubros.find(
        (r) =>
          sugeridoLower.includes(r.nombre.toLowerCase()) ||
          r.nombre.toLowerCase().includes(sugeridoLower),
      );
      if (match) rubroIdInicial = match.id;
    }
    setFormRubroId(rubroIdInicial);
    setFormCostoBase('0.00');
    setFormUnidadPrincipal('un');
    setFormUnidadSecundaria('');
    setFormFactorConversion('1.000');
    setFormPermiteFraccion(false);
    setFormStockMinimo('0.000');
    setFormCodigosBarra(datos.codigosBarra);
    setFormImagenUrl(datos.imagenUrl);
    setOrigenAutocompletado(datos.origen);
    setCandidatosWeb(datos.candidatos ?? []);
    setModalAltaAbierto(true);
  };

  const abrirModalEdicion = (prod: ProductoItem): void => {
    setFormId(prod.id);
    setFormCodigo(prod.codigo);
    setFormSku(prod.sku ?? '');
    setFormNombre(prod.nombre);
    setFormMarca(prod.marca ?? '');
    setFormRubroId(prod.rubro_id ?? (rubros[0]?.id ?? ''));
    setFormCostoBase(prod.costo_base);
    setFormUnidadPrincipal(prod.unidad_principal);
    setFormUnidadSecundaria(prod.unidad_secundaria ?? '');
    setFormFactorConversion(prod.factor_conversion);
    setFormPermiteFraccion(prod.permite_fraccion);
    setFormStockMinimo(prod.stock_minimo);
    setFormCodigosBarra(prod.codigo);
    setFormImagenUrl(prod.imagen_url ?? '');
    setOrigenAutocompletado(null);
    setCandidatosWeb([]);
    setModalAltaAbierto(true);
  };

  const guardarProducto = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!formCodigo.trim() || !formNombre.trim()) {
      setAviso('El código y el nombre del artículo son obligatorios');
      return;
    }

    const payload = {
      codigo: formCodigo.trim(),
      sku: formSku.trim() || undefined,
      nombre: formNombre.trim(),
      marca: formMarca.trim() || undefined,
      rubroId: formRubroId || undefined,
      costoBase: formCostoBase.includes('.') ? formCostoBase : `${formCostoBase || '0'}.00`,
      unidadPrincipal: formUnidadPrincipal.trim() || 'un',
      unidadSecundaria: formPermiteFraccion ? formUnidadSecundaria.trim() || undefined : undefined,
      factorConversion: formPermiteFraccion ? formFactorConversion.trim() || '1.000' : '1.000',
      permiteFraccion: formPermiteFraccion,
      stockMinimo: formStockMinimo.trim() || '0.000',
      imagenUrl: formImagenUrl.trim() ? normalizarUrlImagen(formImagenUrl.trim()) : undefined,
      codigosBarra: formCodigosBarra
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    };

    try {
      const url = formId ? `/api/productos/${formId}` : '/api/productos';
      const method = formId ? 'PUT' : 'POST';

      const res = await fetch(apiUrl(url), {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al guardar producto');
      }

      setModalAltaAbierto(false);
      limpiarFormularioAlta();
      setAviso(`Artículo ${formNombre} guardado correctamente.`);
      void cargarProductos();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const registrarAjusteStock = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!productoSeleccionado) return;

    try {
      const res = await fetch(apiUrl('/api/stock/ajuste'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productoId: productoSeleccionado.id,
          tipo: ajusteTipo,
          cantidad: ajusteCantidad.includes('.') ? ajusteCantidad : `${ajusteCantidad || '1'}.000`,
          unidad: ajusteUnidad,
          notas: ajusteNotas.trim() || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error('Error al registrar ajuste de stock');
      }

      setModalAjusteAbierto(false);
      setAviso(`Stock de ${productoSeleccionado.nombre} actualizado en Kardex.`);
      void cargarProductos();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'Error en ajuste');
    }
  };

  const puedeModificar = rolUsuario === 'encargado' || rolUsuario === 'dueno';

  return (
    <div className="space-y-6">
      {/* Banner de Aviso */}
      {aviso && (
        <div
          data-testid="banner-aviso-catalogo"
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-950 flex justify-between items-center"
        >
          <span>{aviso}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
            }}
            className="text-xs text-blue-700 underline font-bold"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Barra de Pistola de Código de Barras / EAN */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 p-5 text-white shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-600/30 p-3 border border-indigo-500/40 text-2xl">
              🔫
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Pistola Lector de Código de Barras & QR
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                  Activa (Escaneo Automático)
                </span>
              </h2>
              <p className="text-xs text-slate-300">
                Dispará directamente con la pistola en cualquier momento. Si el producto es nuevo,
                lo buscará en Mercado Libre para autocompletar nombre, marca y foto en 3 segundos.
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void procesarDisparoPistola(codigoPistolaInput);
            }}
            className="flex items-center gap-2"
          >
            <input
              id="pistola-input"
              type="text"
              placeholder="Escaneo manual o EAN..."
              value={codigoPistolaInput}
              onChange={(e) => {
                setCodigoPistolaInput(e.target.value);
              }}
              className="rounded-xl bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-400 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48 md:w-56"
            />
            <button
              type="submit"
              disabled={buscandoEan}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
            >
              {buscandoEan ? 'Buscando...' : 'Buscar'}
            </button>
          </form>
        </div>
      </div>

      {/* Controles de Catálogo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 md:w-80">
            <input
              type="text"
              placeholder="Buscar por código, SKU, nombre, marca o barra..."
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (busqueda.trim() && productos.length === 0) {
                    void procesarDisparoPistola(busqueda);
                  }
                }
              }}
              className="rounded-xl bg-white pl-4 pr-9 py-2 text-sm text-slate-900 border border-slate-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
            />
            {busqueda.trim() && (
              <button
                type="button"
                title="Limpiar búsqueda"
                onClick={() => {
                  setBusqueda('');
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={buscandoEan || !busqueda.trim()}
            onClick={() => {
              void procesarDisparoPistola(busqueda);
            }}
            className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
            title="Buscar código o descripción en internet para autocompletar alta"
          >
            <span>🌐</span>
            <span>{buscandoEan ? 'Buscando en web...' : 'Buscar en Web / EAN'}</span>
          </button>

          <select
            value={rubroFiltro}
            onChange={(e) => {
              setRubroFiltro(e.target.value);
            }}
            className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700 border border-slate-300 shadow-sm"
          >
            <option value="">Todos los rubros</option>
            {rubros.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
        </div>

        {puedeModificar && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="btn-actualizar-precios"
              onClick={() => {
                setMostrarActualizadorPrecios((prev) => !prev);
              }}
              className="rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-2 text-sm font-bold text-purple-700 shadow-sm hover:bg-purple-100 flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>⚡</span>
              <span>Actualizar Precios</span>
            </button>

            <button
              type="button"
              data-testid="btn-carga-masiva"
              onClick={() => {
                setModalImportarAbierto(true);
              }}
              className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-100 flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>📥</span>
              <span>Carga Masiva (Excel/CSV)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                abrirModalAltaConDatos({
                  codigo: '',
                  sku: '',
                  nombre: '',
                  marca: '',
                  imagenUrl: '',
                  codigosBarra: '',
                  origen: null,
                  candidatos: [],
                });
              }}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-500 flex items-center justify-center gap-2"
            >
              <span>+ Nuevo Artículo</span>
            </button>
          </div>
        )}
      </div>

      {mostrarActualizadorPrecios && (
        <ActualizadorMasivoPrecios
          token={token}
          rolUsuario={rolUsuario}
          rubros={rubros}
          onActualizacionExitosa={() => {
            void cargarProductos();
          }}
          onCerrar={() => { setMostrarActualizadorPrecios(false); }}
        />
      )}

      {/* Tabla de Artículos con Stock Vivo y Precios por Lista */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-800">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Artículo</th>
                <th className="px-4 py-3">Rubro</th>
                <th className="px-4 py-3 text-right">Costo Base</th>
                <th className="px-4 py-3 text-right">Mostrador (+60%)</th>
                <th className="px-4 py-3 text-right">Gremio (+40%)</th>
                <th className="px-4 py-3 text-right">Stock Vivo</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Cargando catálogo...
                  </td>
                </tr>
              ) : productos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {busqueda.trim() ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-4">
                        <p className="text-base text-slate-700 font-medium">
                          No se encontró ningún artículo local con &quot;
                          <span className="font-bold text-slate-900">{busqueda}</span>&quot;
                        </p>
                        <p className="text-xs text-slate-500 max-w-md">
                          Podés consultar este código o descripción en internet para autocompletar el alta del producto en el catálogo.
                        </p>
                        <button
                          type="button"
                          disabled={buscandoEan}
                          onClick={() => {
                            void procesarDisparoPistola(busqueda);
                          }}
                          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-blue-500 flex items-center gap-2 transition disabled:opacity-50"
                        >
                          <span>⚡</span>
                          <span>
                            {buscandoEan
                              ? 'Buscando en la web...'
                              : `Buscar "${busqueda}" en la Web y dar de alta`}
                          </span>
                        </button>
                      </div>
                    ) : (
                      'No se encontraron productos en el catálogo. Dispará con la pistola o hacé clic en "+ Nuevo Artículo".'
                    )}
                  </td>
                </tr>
              ) : (
                productos.map((prod) => {
                  const stockNum = Number(prod.stock_actual_base);
                  const stockMinNum = Number(prod.stock_minimo);
                  const stockBajo = stockMinNum > 0 && stockNum <= stockMinNum;

                  return (
                    <tr key={prod.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {prod.imagen_url ? (
                            <img
                              src={prod.imagen_url}
                              alt={prod.nombre}
                              className="h-10 w-10 rounded-lg object-cover border border-slate-200 bg-white"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                if (img.src.includes('drive.google.com/thumbnail?id=')) {
                                  const match = img.src.match(/id=([a-zA-Z0-9_-]+)/);
                                  if (match?.[1]) {
                                    img.src = `https://lh3.googleusercontent.com/d/${match[1]}`;
                                    return;
                                  }
                                }
                                img.style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 font-bold text-xs">
                              {prod.unidad_principal.toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900">{prod.nombre}</div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                              <span>Cód: {prod.codigo}</span>
                              {prod.sku && <span className="font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">SKU: {prod.sku}</span>}
                              {prod.marca && <span>· Marca: {prod.marca}</span>}
                              {prod.permite_fraccion && (
                                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                  Fraccionable (1 {prod.unidad_principal} = {prod.factor_conversion}{' '}
                                  {prod.unidad_secundaria})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{prod.rubro_nombre}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatearPesos(prod.costo_base)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-800">
                        {prod.precios['Mostrador']
                          ? formatearPesos(prod.precios['Mostrador'])
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-800">
                        {prod.precios['Gremio'] ? formatearPesos(prod.precios['Gremio']) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div
                          className={`font-black ${
                            stockBajo
                              ? 'text-rose-600'
                              : stockNum <= 0
                                ? 'text-amber-600'
                                : 'text-slate-900'
                          }`}
                        >
                          {prod.stock_actual_base} {prod.unidad_principal}
                        </div>
                        {stockBajo && (
                          <span className="text-[10px] font-bold text-rose-500 block">
                            ¡Bajo stock mínimo ({prod.stock_minimo})!
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            title="Imprimir Etiqueta con Código de Barras / QR"
                            onClick={() => {
                              setProductoSeleccionado(prod);
                              setModalEtiquetaAbierto(true);
                            }}
                            className="rounded-lg bg-slate-100 p-1.5 text-slate-700 hover:bg-slate-200"
                          >
                            🏷️
                          </button>
                          {puedeModificar && (
                            <>
                              <button
                                type="button"
                                title="Ajuste de Stock (Kardex)"
                                onClick={() => {
                                  setProductoSeleccionado(prod);
                                  setAjusteTipo('ajuste_sobrante');
                                  setAjusteCantidad('1.000');
                                  setAjusteUnidad('principal');
                                  setAjusteNotas('');
                                  setModalAjusteAbierto(true);
                                }}
                                className="rounded-lg bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100"
                              >
                                📦
                              </button>
                              <button
                                type="button"
                                title="Editar Artículo"
                                onClick={() => {
                                  abrirModalEdicion(prod);
                                }}
                                className="rounded-lg bg-blue-50 p-1.5 text-blue-700 hover:bg-blue-100"
                              >
                                ✏️
                              </button>
                            </>
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

      {/* MODAL: Alta / Edición de Producto */}
      {modalAltaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {formId ? 'Editar Artículo' : 'Nuevo Artículo en Catálogo'}
                </h3>
                {origenAutocompletado && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 w-fit">
                    <span>⚡ Datos autocompletados desde {origenAutocompletado}</span>
                  </div>
                )}
                {buscandoEnModal && (
                  <div className="mt-1 flex items-center gap-2 text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 w-fit animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
                    <span>Buscando datos del producto en internet...</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={limpiarFormularioAlta}
                  title="Limpiar todos los campos del formulario para ingresar otro artículo"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  🔄 Limpiar datos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalAltaAbierto(false);
                    limpiarFormularioAlta();
                  }}
                  className="text-slate-400 hover:text-slate-600 font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={(e) => { void guardarProducto(e); }} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-slate-600">Cód. Interno / Barra</label>
                    <span className="text-[10px] text-slate-400">Escaneá o Enter</span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <input
                      type="text"
                      required
                      placeholder="Código o EAN..."
                      value={formCodigo}
                      onChange={(e) => {
                        setFormCodigo(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (formCodigo.trim()) {
                            void consultarEanYAutocompletar(formCodigo);
                          }
                        }
                      }}
                      className="w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <button
                      type="button"
                      disabled={buscandoEnModal || !formCodigo.trim()}
                      onClick={() => {
                        void consultarEanYAutocompletar(formCodigo);
                      }}
                      title="Buscar datos del artículo en internet"
                      className="shrink-0 px-2.5 py-2 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 text-blue-700 font-bold text-xs rounded-xl border border-blue-200 transition"
                    >
                      {buscandoEnModal ? '⏳' : '⚡ Web'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">
                    SKU (Código Fábrica / Modelo)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. KL29110N, DWE575"
                    value={formSku}
                    onChange={(e) => {
                      setFormSku(e.target.value);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Marca</label>
                  <input
                    type="text"
                    placeholder="Ej. Bosch, Stanley, Kalop"
                    value={formMarca}
                    onChange={(e) => {
                      setFormMarca(e.target.value);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-600">
                  Nombre Comercial del Producto
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Taladro Percutor 650W o Cable Taller 2x2.5"
                  value={formNombre}
                  onChange={(e) => {
                    setFormNombre(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                />

                {candidatosWeb.length > 1 && (
                  <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 text-xs">
                    <div className="flex items-center justify-between font-bold text-indigo-950 mb-1.5">
                      <span>💡 Coincidencias aproximadas detectadas en la web:</span>
                      <span className="text-[10px] text-indigo-600 font-normal">Hacé clic para aplicar</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {candidatosWeb.slice(0, 4).map((cand, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setFormNombre(cand.nombre);
                            setFormMarca(cand.marca ?? '');
                            setFormSku(cand.sku ?? '');
                            if (cand.rubro) {
                              const rubroCand = cand.rubro.toLowerCase();
                              const rMatch = rubros.find(
                                (r) =>
                                  r.nombre.toLowerCase().includes(rubroCand) ||
                                  rubroCand.includes(r.nombre.toLowerCase()),
                              );
                              if (rMatch) setFormRubroId(rMatch.id);
                            }
                          }}
                          className={`rounded-lg border px-2 py-1 text-left transition ${
                            formNombre === cand.nombre
                              ? 'bg-indigo-600 text-white border-indigo-700 font-bold'
                              : 'bg-white text-slate-800 border-slate-200 hover:bg-indigo-100 hover:border-indigo-300'
                          }`}
                        >
                          <div className="font-semibold truncate max-w-[240px]">{cand.nombre}</div>
                          <div className="text-[10px] opacity-80 flex items-center gap-1.5">
                            {cand.marca && <span>Marca: {cand.marca}</span>}
                            {cand.sku && (
                              <span className="font-mono bg-indigo-100/60 px-1 rounded">
                                SKU: {cand.sku}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Rubro</label>
                  <select
                    value={formRubroId}
                    onChange={(e) => {
                      setFormRubroId(e.target.value);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
                  >
                    {rubros.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">
                    Costo Base de Compra ($)
                  </label>
                  <input
                    type="text"
                    required
                    value={formCostoBase}
                    onChange={(e) => {
                      setFormCostoBase(e.target.value);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 font-bold"
                  />
                </div>
              </div>

              {/* Vista previa de precios calculados según listas */}
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                <div className="text-xs font-bold text-slate-700 uppercase">
                  Precios Calculados por Margen:
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {listasPrecios.map((lp) => {
                    const costoNum = Number(formCostoBase) || 0;
                    const precioCalc = costoNum * (1 + Number(lp.margenPct) / 100);
                    return (
                      <div key={lp.id} className="rounded-lg bg-white p-2 border border-slate-200">
                        <div className="text-slate-500 font-medium">
                          {lp.nombre} (+{lp.margenPct}%)
                        </div>
                        <div className="font-bold text-slate-900 text-sm">
                          {formatearPesos(precioCalc.toFixed(2))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Configuración de Fraccionamiento */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formPermiteFraccion}
                    onChange={(e) => {
                      setFormPermiteFraccion(e.target.checked);
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <span className="text-sm font-bold text-indigo-950">
                    Permite venta fraccionada (ej. por metro, kilo o corte)
                  </span>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Unidad Principal</label>
                    <input
                      type="text"
                      placeholder="ej: rollo, caja, bolsa"
                      value={formUnidadPrincipal}
                      onChange={(e) => {
                        setFormUnidadPrincipal(e.target.value);
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 bg-white"
                    />
                  </div>
                  {formPermiteFraccion && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-slate-600">
                          Unidad Secundaria
                        </label>
                        <input
                          type="text"
                          placeholder="ej: metro, kg, un"
                          value={formUnidadSecundaria}
                          onChange={(e) => {
                            setFormUnidadSecundaria(e.target.value);
                          }}
                          className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-600">
                          Equivalencia (Factor)
                        </label>
                        <input
                          type="text"
                          placeholder="ej: 100.000"
                          value={formFactorConversion}
                          onChange={(e) => {
                            setFormFactorConversion(e.target.value);
                          }}
                          className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 bg-white font-semibold"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Códigos de barra adicionales y foto con preview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-slate-600">
                      Códigos de Barra (EAN-13 / UPC)
                    </label>
                    <span className="text-[10px] text-slate-400">Separados por coma</span>
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      type="text"
                      placeholder="Ej. 7791234567890, 7790987654321"
                      value={formCodigosBarra}
                      onChange={(e) => {
                        setFormCodigosBarra(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const primerCodigo = formCodigosBarra.split(',')[0]?.trim();
                          if (primerCodigo) {
                            void consultarEanYAutocompletar(primerCodigo);
                          }
                        }
                      }}
                      className="w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 font-mono"
                    />
                    <button
                      type="button"
                      disabled={buscandoEnModal || !formCodigosBarra.trim()}
                      onClick={() => {
                        const primerCodigo = formCodigosBarra.split(',')[0]?.trim();
                        if (primerCodigo) {
                          void consultarEanYAutocompletar(primerCodigo);
                        }
                      }}
                      title="Buscar datos del primer código de barra en internet"
                      className="shrink-0 px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition"
                    >
                      {buscandoEnModal ? '⏳' : '🔍'}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-slate-600">
                      Foto / Modelo del Producto
                    </label>
                    <span className="text-[10px] text-slate-400">
                      Link web, Google Drive o archivo
                    </span>
                  </div>
                  <div className="mt-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Pegá link de Google Drive (https://drive.google.com/...) o web"
                        value={formImagenUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormImagenUrl(normalizarUrlImagen(val));
                        }}
                        onPaste={(e) => {
                          const texto = e.clipboardData.getData('text');
                          if (
                            texto &&
                            (texto.includes('drive.google.com') ||
                              texto.includes('docs.google.com') ||
                              texto.includes('dropbox.com'))
                          ) {
                            e.preventDefault();
                            setFormImagenUrl(normalizarUrlImagen(texto));
                          }
                        }}
                        className="w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />

                      <label
                        title="Subir archivo desde tu computadora o Google Drive"
                        className="shrink-0 cursor-pointer rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition flex items-center gap-1.5 shadow-xs"
                      >
                        <span>📁</span>
                        <span>Subir Foto</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleSubirArchivoImagen}
                        />
                      </label>
                    </div>

                    {formImagenUrl &&
                      (formImagenUrl.includes('drive.google.com') ||
                        formImagenUrl.includes('googleusercontent.com')) && (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                          <span>✓</span>
                          <span>
                            Archivo de Google Drive detectado y vinculado directamente como foto del modelo.
                          </span>
                        </div>
                      )}

                    {formImagenUrl && (
                      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                        <img
                          src={formImagenUrl}
                          alt="Vista previa modelo"
                          className="h-14 w-14 rounded-lg border border-slate-200 object-cover bg-white shrink-0"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (img.src.includes('drive.google.com/thumbnail?id=')) {
                              const match = img.src.match(/id=([a-zA-Z0-9_-]+)/);
                              if (match?.[1]) {
                                img.src = `https://lh3.googleusercontent.com/d/${match[1]}`;
                                return;
                              }
                            }
                            img.style.display = 'none';
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-slate-800 truncate">
                            {formImagenUrl.startsWith('data:image/')
                              ? 'Foto cargada desde archivo (Drive / PC)'
                              : formImagenUrl}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Esta imagen se mostrará en el catálogo y mostrador como modelo visual.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setFormImagenUrl('');
                          }}
                          className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2.5 py-1 rounded-lg hover:bg-rose-50 transition border border-rose-200 shrink-0"
                          title="Quitar foto"
                        >
                          ✕ Quitar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setModalAltaAbierto(false);
                    limpiarFormularioAlta();
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-blue-500"
                >
                  Guardar Artículo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Ajuste de Stock (Kardex inmutable) */}
      {modalAjusteAbierto && productoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">
              Ajuste de Stock — {productoSeleccionado.nombre}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Stock actual registrado en Kardex:{' '}
              <strong>
                {productoSeleccionado.stock_actual_base} {productoSeleccionado.unidad_principal}
              </strong>
            </p>

            <form onSubmit={(e) => { void registrarAjusteStock(e); }} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Motivo del Ajuste</label>
                <select
                  value={ajusteTipo}
                  onChange={(e) => {
                    setAjusteTipo(
                      e.target.value as
                        | 'ajuste_sobrante'
                        | 'ajuste_faltante'
                        | 'merma_rotura'
                        | 'ingreso_compra',
                    );
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
                >
                  <option value="ingreso_compra">Ingreso por Compra / Remito (+)</option>
                  <option value="ajuste_sobrante">Ajuste por Conteo Físico Sobrante (+)</option>
                  <option value="ajuste_faltante">Ajuste por Conteo Físico Faltante (-)</option>
                  <option value="merma_rotura">Merma / Rotura / Vencido (-)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Cantidad</label>
                  <input
                    type="text"
                    required
                    value={ajusteCantidad}
                    onChange={(e) => {
                      setAjusteCantidad(e.target.value);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900 font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Unidad</label>
                  <select
                    value={ajusteUnidad}
                    onChange={(e) => {
                      setAjusteUnidad(e.target.value as 'principal' | 'secundaria');
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
                  >
                    <option value="principal">{productoSeleccionado.unidad_principal}</option>
                    {productoSeleccionado.permite_fraccion &&
                      productoSeleccionado.unidad_secundaria && (
                        <option value="secundaria">
                          {productoSeleccionado.unidad_secundaria} (Fracc.)
                        </option>
                      )}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Notas / Remito</label>
                <input
                  type="text"
                  placeholder="Ej. Recuento estantería A-4 o Factura Prov. #1234"
                  value={ajusteNotas}
                  onChange={(e) => {
                    setAjusteNotas(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setModalAjusteAbierto(false);
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-bold text-white shadow hover:bg-amber-500"
                >
                  Registrar en Kardex
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Etiqueta Imprimible con Código de Barras y QR */}
      {modalEtiquetaAbierto && productoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Etiqueta de Estantería</h3>
              <button
                type="button"
                onClick={() => {
                  setModalEtiquetaAbierto(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {/* Tarjeta de Etiqueta Estilo Ferretería */}
            <div
              id="etiqueta-imprimible"
              className="mt-4 rounded-xl border-2 border-dashed border-slate-400 p-4 bg-white text-center space-y-2"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {productoSeleccionado.rubro_nombre}
              </div>
              <div className="text-base font-black text-slate-900 leading-tight">
                {productoSeleccionado.nombre}
              </div>
              <div className="text-2xl font-black text-slate-900 my-2">
                {productoSeleccionado.precios['Mostrador']
                  ? formatearPesos(productoSeleccionado.precios['Mostrador'])
                  : '-'}
              </div>

              {/* Código de barras simulado vectorial */}
              <div className="flex justify-center items-center py-2">
                <svg className="w-48 h-12" viewBox="0 0 200 50">
                  <rect x="0" y="0" width="4" height="40" fill="black" />
                  <rect x="8" y="0" width="2" height="40" fill="black" />
                  <rect x="14" y="0" width="6" height="40" fill="black" />
                  <rect x="24" y="0" width="2" height="40" fill="black" />
                  <rect x="30" y="0" width="8" height="40" fill="black" />
                  <rect x="42" y="0" width="4" height="40" fill="black" />
                  <rect x="50" y="0" width="2" height="40" fill="black" />
                  <rect x="56" y="0" width="6" height="40" fill="black" />
                  <rect x="66" y="0" width="4" height="40" fill="black" />
                  <rect x="74" y="0" width="6" height="40" fill="black" />
                  <rect x="84" y="0" width="2" height="40" fill="black" />
                  <rect x="90" y="0" width="4" height="40" fill="black" />
                  <rect x="98" y="0" width="8" height="40" fill="black" />
                  <rect x="110" y="0" width="2" height="40" fill="black" />
                  <rect x="116" y="0" width="4" height="40" fill="black" />
                  <rect x="124" y="0" width="6" height="40" fill="black" />
                  <rect x="134" y="0" width="2" height="40" fill="black" />
                  <rect x="140" y="0" width="8" height="40" fill="black" />
                  <rect x="152" y="0" width="4" height="40" fill="black" />
                  <rect x="160" y="0" width="2" height="40" fill="black" />
                  <rect x="166" y="0" width="6" height="40" fill="black" />
                  <rect x="176" y="0" width="4" height="40" fill="black" />
                  <rect x="184" y="0" width="6" height="40" fill="black" />
                  <rect x="194" y="0" width="4" height="40" fill="black" />
                  <text x="100" y="48" fontSize="10" textAnchor="middle" fill="black">
                    {productoSeleccionado.codigo}
                  </text>
                </svg>
              </div>

              <div className="text-[11px] font-mono text-slate-500">
                SKU: {productoSeleccionado.codigo} · Estante Ferretería
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white shadow hover:bg-slate-800"
              >
                🖨️ Imprimir Etiqueta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Importación Masiva desde Excel / CSV */}
      {modalImportarAbierto && (
        <ImportadorMasivoModal
          token={token}
          productosActuales={productos}
          onCerrar={() => {
            setModalImportarAbierto(false);
          }}
          onImportadoExitoso={(mensaje) => {
            setAviso(mensaje);
            void cargarProductos();
          }}
        />
      )}
    </div>
  );
}
