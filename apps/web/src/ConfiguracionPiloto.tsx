import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  aCentavos,
  deCentavos,
  type DatosEmpresaItem,
  type RolUsuario,
  type UsuarioItemAdmin,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';
import { GestionListasYReglas } from './GestionListasYReglas.js';

interface MedioPagoConfigItem {
  id: string;
  nombre: string;
  esEfectivo: boolean;
  diasAcreditacion: number;
  comisionPct: string;
  activo: boolean;
}

interface RubroConfigItem {
  id: string;
  nombre: string;
}

interface CategoriaConfigItem {
  id: string;
  nombre: string;
  tipo: 'ingreso' | 'egreso';
}

interface RegistroBitacoraPiloto {
  fecha: string;
  efectivoSistema: string;
  efectivoPlanilla: string;
  diferenciaConPlanilla: string;
  observacion: string;
  registradoEn: string;
}

export interface ConfiguracionPilotoProps {
  token: string;
  rolActivo: RolUsuario;
  efectivoEsperadoActual: string;
  onSolicitarRolDueno: () => void;
  onCatalogosActualizados: () => Promise<void>;
}

const STORAGE_KEY_PILOTO = 'ferreteria_bitacora_piloto_v1';

function hoyIsoLocal(): string {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${String(anio)}-${mes}-${dia}`;
}

export function ConfiguracionPiloto({
  token,
  rolActivo,
  efectivoEsperadoActual,
  onSolicitarRolDueno,
  onCatalogosActualizados,
}: ConfiguracionPilotoProps): ReactElement {
  const [tabActiva, setTabActiva] = useState<
    'empresa' | 'usuarios' | 'permisos' | 'precios' | 'catalogos' | 'bitacora'
  >('empresa');

  // Catálogos
  const [mediosPago, setMediosPago] = useState<MedioPagoConfigItem[]>([]);
  const [rubros, setRubros] = useState<RubroConfigItem[]>([]);
  const [categorias, setCategorias] = useState<CategoriaConfigItem[]>([]);
  const [estadoSalud, setEstadoSalud] = useState<string>('verificando...');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Formulario de Empresa
  const [cargandoEmpresa, setCargandoEmpresa] = useState<boolean>(false);
  const [nombreComercial, setNombreComercial] = useState<string>('');
  const [razonSocial, setRazonSocial] = useState<string>('');
  const [cuit, setCuit] = useState<string>('');
  const [condicionIva, setCondicionIva] = useState<
    'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final'
  >('responsable_inscripto');
  const [iibb, setIibb] = useState<string>('');
  const [inicioActividades, setInicioActividades] = useState<string>('');
  const [domicilioComercial, setDomicilioComercial] = useState<string>('');
  const [telefono, setTelefono] = useState<string>('');
  const [emailEmpresa, setEmailEmpresa] = useState<string>('');
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [leyendaTicket, setLeyendaTicket] = useState<string>('');

  // Gestión de Usuarios
  const [usuarios, setUsuarios] = useState<UsuarioItemAdmin[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState<boolean>(false);
  const [mostrarModalUsuario, setMostrarModalUsuario] =
    useState<boolean>(false);
  const [usuarioEditandoId, setUsuarioEditandoId] = useState<string | null>(
    null,
  );
  const [usuarioNombre, setUsuarioNombre] = useState<string>('');
  const [usuarioEmail, setUsuarioEmail] = useState<string>('');
  const [usuarioRol, setUsuarioRol] = useState<RolUsuario>('cajero');
  const [usuarioActivo, setUsuarioActivo] = useState<boolean>(true);
  const [usuarioPassword, setUsuarioPassword] = useState<string>('');

  // Modal de restablecer contraseña
  const [usuarioPasswordModalId, setUsuarioPasswordModalId] = useState<
    string | null
  >(null);
  const [usuarioPasswordModalNombre, setUsuarioPasswordModalNombre] =
    useState<string>('');
  const [nuevaPasswordDirecta, setNuevaPasswordDirecta] = useState<string>('');

  // Formulario de medio de pago
  const [medioEditId, setMedioEditId] = useState<string | null>(null);
  const [medioNombre, setMedioNombre] = useState<string>('');
  const [medioEsEfectivo, setMedioEsEfectivo] = useState<boolean>(false);
  const [medioDiasAcreditacion, setMedioDiasAcreditacion] =
    useState<string>('1');
  const [medioComisionPct, setMedioComisionPct] = useState<string>('0.00');

  // Formulario de rubro
  const [nuevoRubroNombre, setNuevoRubroNombre] = useState<string>('');

  // Formulario de categoría
  const [nuevaCategoriaNombre, setNuevaCategoriaNombre] = useState<string>('');
  const [nuevaCategoriaTipo, setNuevaCategoriaTipo] = useState<
    'ingreso' | 'egreso'
  >('egreso');

  // Bitácora del piloto
  const [fechaPiloto, setFechaPiloto] = useState<string>(hoyIsoLocal());
  const [efectivoPlanillaInput, setEfectivoPlanillaInput] = useState<string>(
    efectivoEsperadoActual,
  );
  const [observacionPilotoInput, setObservacionPilotoInput] =
    useState<string>('');
  const [bitacoraPiloto, setBitacoraPiloto] = useState<
    RegistroBitacoraPiloto[]
  >(() => {
    try {
      const guardado = localStorage.getItem(STORAGE_KEY_PILOTO);
      if (guardado) {
        return JSON.parse(guardado) as RegistroBitacoraPiloto[];
      }
    } catch {
      // Ignorar
    }
    return [];
  });

  // Carga de datos de empresa
  const cargarEmpresa = useCallback(async () => {
    try {
      setCargandoEmpresa(true);
      const res = await fetch(apiUrl('/api/configuracion/empresa'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { empresa: DatosEmpresaItem };
        const emp = data.empresa;
        setNombreComercial(emp.nombre || '');
        setRazonSocial(emp.razonSocial || '');
        setCuit(emp.cuit || '');
        setCondicionIva(
          emp.condicionIva as
            | 'responsable_inscripto'
            | 'monotributo'
            | 'exento'
            | 'consumidor_final',
        );
        setIibb(emp.iibb || '');
        setInicioActividades(emp.inicioActividades || '');
        setDomicilioComercial(emp.domicilioComercial || '');
        setTelefono(emp.telefono || '');
        setEmailEmpresa(emp.email || '');
        setLogoUrl(emp.logoUrl || '');
        setLeyendaTicket(emp.leyendaTicket || '');
      }
    } catch {
      setErrorMsg('No se pudieron cargar los datos de la empresa.');
    } finally {
      setCargandoEmpresa(false);
    }
  }, [token]);

  // Carga de usuarios
  const cargarUsuarios = useCallback(async () => {
    try {
      setCargandoUsuarios(true);
      const res = await fetch(apiUrl('/api/configuracion/usuarios'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { usuarios: UsuarioItemAdmin[] };
        setUsuarios(data.usuarios);
      }
    } catch {
      setErrorMsg('No se pudo cargar el listado de usuarios.');
    } finally {
      setCargandoUsuarios(false);
    }
  }, [token]);

  // Carga de catálogos y healthcheck
  const cargarCatalogos = useCallback(async () => {
    try {
      const [resCat, resHealth] = await Promise.all([
        fetch(apiUrl('/api/configuracion/catalogos'), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl('/api/health/ready')),
      ]);

      if (resHealth.ok) {
        const healthData = (await resHealth.json()) as {
          status: string;
          dbRole: string;
        };
        setEstadoSalud(`OK (${healthData.status} · RLS: ${healthData.dbRole})`);
      }

      if (!resCat.ok) {
        return;
      }
      const data = (await resCat.json()) as {
        mediosPago: MedioPagoConfigItem[];
        rubros: RubroConfigItem[];
        categorias: CategoriaConfigItem[];
      };
      setMediosPago(data.mediosPago);
      setRubros(data.rubros);
      setCategorias(data.categorias);
    } catch {
      setErrorMsg('No se pudieron cargar los catálogos de configuración.');
    }
  }, [token]);

  useEffect(() => {
    if (rolActivo === 'dueno' || rolActivo === 'encargado') {
      void cargarCatalogos();
      void cargarEmpresa();
      void cargarUsuarios();
    }
  }, [rolActivo, cargarCatalogos, cargarEmpresa, cargarUsuarios]);

  // Guardar datos de empresa
  const guardarEmpresa = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setMensaje(null);
    setErrorMsg(null);

    if (!nombreComercial.trim()) {
      setErrorMsg('El nombre comercial es obligatorio.');
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/configuracion/empresa'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: nombreComercial.trim(),
          razonSocial: razonSocial.trim() || null,
          cuit: cuit.trim() || null,
          condicionIva,
          iibb: iibb.trim() || null,
          inicioActividades: inicioActividades.trim() || null,
          domicilioComercial: domicilioComercial.trim() || null,
          telefono: telefono.trim() || null,
          email: emailEmpresa.trim() || null,
          logoUrl: logoUrl.trim() || null,
          leyendaTicket: leyendaTicket.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudo guardar la configuración de la empresa.');
        return;
      }

      setMensaje('Datos comerciales y de branding guardados exitosamente.');
      await cargarEmpresa();
    } catch {
      setErrorMsg('Error de red al guardar los datos de la empresa.');
    }
  };

  // Cargar imagen de logo local
  const procesarLogoLocal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('El archivo seleccionado debe ser una imagen (PNG, JPG, SVG).');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('La imagen no debe superar los 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setLogoUrl(base64);
    };
    reader.readAsDataURL(file);
  };

  // Guardar Usuario (Crear o Editar)
  const guardarUsuario = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setMensaje(null);
    setErrorMsg(null);

    if (!usuarioNombre.trim() || !usuarioEmail.trim()) {
      setErrorMsg('Completá nombre y correo electrónico válidos.');
      return;
    }

    if (!usuarioEditandoId && (!usuarioPassword || usuarioPassword.length < 6)) {
      setErrorMsg('La contraseña inicial debe tener al menos 6 caracteres.');
      return;
    }

    try {
      const url = usuarioEditandoId
        ? apiUrl(`/api/configuracion/usuarios/${usuarioEditandoId}`)
        : apiUrl('/api/configuracion/usuarios');
      const method = usuarioEditandoId ? 'PUT' : 'POST';

      const payload: Record<string, unknown> = {
        nombre: usuarioNombre.trim(),
        email: usuarioEmail.trim(),
        rol: usuarioRol,
        activo: usuarioActivo,
      };

      if (usuarioPassword.trim().length >= 6) {
        payload['password'] = usuarioPassword.trim();
      }

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
        setErrorMsg(err.error ?? 'No se pudo guardar el usuario.');
        return;
      }

      setMensaje(
        usuarioEditandoId
          ? 'Usuario actualizado correctamente.'
          : 'Usuario creado exitosamente con sus credenciales de acceso.',
      );
      setMostrarModalUsuario(false);
      setUsuarioEditandoId(null);
      setUsuarioNombre('');
      setUsuarioEmail('');
      setUsuarioPassword('');
      setUsuarioRol('cajero');
      setUsuarioActivo(true);
      await cargarUsuarios();
    } catch {
      setErrorMsg('Error de conexión al guardar el usuario.');
    }
  };

  // Restablecer contraseña directa
  const guardarNuevaPassword = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!usuarioPasswordModalId || nuevaPasswordDirecta.length < 6) {
      setErrorMsg('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    try {
      const res = await fetch(
        apiUrl(`/api/configuracion/usuarios/${usuarioPasswordModalId}/password`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ password: nuevaPasswordDirecta }),
        },
      );

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudo restablecer la contraseña.');
        return;
      }

      setMensaje(
        `Contraseña de ${usuarioPasswordModalNombre} actualizada con éxito.`,
      );
      setUsuarioPasswordModalId(null);
      setNuevaPasswordDirecta('');
    } catch {
      setErrorMsg('Error de conexión al cambiar la contraseña.');
    }
  };

  // Toggle activo de usuario
  const toggleActivoUsuario = async (u: UsuarioItemAdmin) => {
    try {
      const res = await fetch(apiUrl(`/api/configuracion/usuarios/${u.id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: u.nombre,
          email: u.email,
          rol: u.rol,
          activo: !u.activo,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudo cambiar el estado del usuario.');
        return;
      }

      setMensaje(`Usuario ${u.nombre} ahora está ${!u.activo ? 'activo' : 'inactivo'}.`);
      await cargarUsuarios();
    } catch {
      setErrorMsg('Error al conectar con el servidor.');
    }
  };

  // Medios de pago, rubros y categorías
  const guardarMedioPago = async () => {
    setMensaje(null);
    setErrorMsg(null);
    const dias = Number.parseInt(medioDiasAcreditacion, 10);
    if (!medioNombre.trim() || Number.isNaN(dias) || dias < 0) {
      setErrorMsg('Completá nombre y días de acreditación válidos.');
      return;
    }

    const res = await fetch(apiUrl('/api/configuracion/medios-pago'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...(medioEditId !== null ? { id: medioEditId } : {}),
        nombre: medioNombre.trim(),
        esEfectivo: medioEsEfectivo,
        diasAcreditacion: dias,
        comisionPct: medioComisionPct.trim(),
        activo: true,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      setErrorMsg(errBody.error ?? 'No se pudo guardar el medio de pago.');
      return;
    }

    setMedioEditId(null);
    setMedioNombre('');
    setMedioEsEfectivo(false);
    setMedioDiasAcreditacion('1');
    setMedioComisionPct('0.00');
    setMensaje('Medio de pago guardado correctamente.');
    await cargarCatalogos();
    await onCatalogosActualizados();
  };

  const guardarRubro = async () => {
    setMensaje(null);
    setErrorMsg(null);
    if (!nuevoRubroNombre.trim()) {
      setErrorMsg('Ingresá el nombre del rubro.');
      return;
    }

    const res = await fetch(apiUrl('/api/configuracion/rubros'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nombre: nuevoRubroNombre.trim() }),
    });

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      setErrorMsg(errBody.error ?? 'No se pudo guardar el rubro.');
      return;
    }

    setNuevoRubroNombre('');
    setMensaje('Rubro guardado correctamente.');
    await cargarCatalogos();
    await onCatalogosActualizados();
  };

  const guardarCategoria = async () => {
    setMensaje(null);
    setErrorMsg(null);
    if (!nuevaCategoriaNombre.trim()) {
      setErrorMsg('Ingresá el nombre de la categoría.');
      return;
    }

    const res = await fetch(apiUrl('/api/configuracion/categorias'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        nombre: nuevaCategoriaNombre.trim(),
        tipo: nuevaCategoriaTipo,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      setErrorMsg(errBody.error ?? 'No se pudo guardar la categoría.');
      return;
    }

    setNuevaCategoriaNombre('');
    setMensaje('Categoría guardada correctamente.');
    await cargarCatalogos();
    await onCatalogosActualizados();
  };

  const registrarComparacionPiloto = () => {
    setMensaje(null);
    setErrorMsg(null);
    try {
      const sistemaCents = aCentavos(efectivoEsperadoActual);
      const planillaCents = aCentavos(efectivoPlanillaInput.trim());
      const diffCents = sistemaCents - planillaCents;

      const nuevoRegistro: RegistroBitacoraPiloto = {
        fecha: fechaPiloto,
        efectivoSistema: deCentavos(sistemaCents),
        efectivoPlanilla: deCentavos(planillaCents),
        diferenciaConPlanilla: deCentavos(diffCents),
        observacion:
          observacionPilotoInput.trim() ||
          (diffCents === 0n
            ? 'Cierre verificado sin diferencias contra planilla'
            : 'Diferencia revisada en arqueo paralelo'),
        registradoEn: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      const actualizada = [
        nuevoRegistro,
        ...bitacoraPiloto.filter((r) => r.fecha !== fechaPiloto),
      ];
      setBitacoraPiloto(actualizada);
      localStorage.setItem(STORAGE_KEY_PILOTO, JSON.stringify(actualizada));
      setObservacionPilotoInput('');
      setMensaje(
        `Comparación del día ${fechaPiloto} registrada en la bitácora del piloto.`,
      );
    } catch {
      setErrorMsg(
        'Ingresá un monto de planilla válido con dos decimales (ej: 5800.00).',
      );
    }
  };

  if (rolActivo !== 'dueno') {
    return (
      <div
        data-testid="panel-requiere-dueno"
        className="rounded-2xl bg-white p-6 shadow-sm border border-amber-300"
      >
        <h2 className="text-lg font-bold text-slate-900">
          Configuración Integral del Negocio y Gestión de Empresa
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Para modificar los datos fiscales y branding de la empresa, gestionar
          usuarios, medios de pago reales y catálogos se requiere rol{' '}
          <strong>Dueño</strong>.
        </p>
        <button
          type="button"
          data-testid="btn-autorizar-dueno"
          onClick={() => {
            onSolicitarRolDueno();
          }}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-slate-800"
        >
          Autorizar como Dueño (Roberto)
        </button>
      </div>
    );
  }

  const diasSinDiferencias = bitacoraPiloto.filter(
    (r) => r.diferenciaConPlanilla === '0.00',
  ).length;

  return (
    <div data-testid="vista-configuracion-piloto" className="space-y-6">
      {/* Cabecera Principal y Monitoreo */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <span>⚙️</span> Configuración General & Gestión de Empresa
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Identidad comercial, logo, usuarios, roles, medios de cobro y
              diagnóstico del sistema.
            </p>
          </div>
          <span
            data-testid="badge-salud-sistema"
            className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-800 flex items-center gap-1.5 shadow-sm"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Monitoreo API: {estadoSalud}
          </span>
        </div>

        {/* Barra de pestañas */}
        <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          <button
            type="button"
            onClick={() => { setTabActiva('empresa'); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tabActiva === 'empresa'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            🏢 Empresa & Branding
          </button>
          <button
            type="button"
            onClick={() => { setTabActiva('usuarios'); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tabActiva === 'usuarios'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            👥 Gestión de Usuarios ({usuarios.length})
          </button>
          <button
            type="button"
            onClick={() => { setTabActiva('permisos'); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tabActiva === 'permisos'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            🛡️ Matriz de Roles
          </button>
          <button
            type="button"
            onClick={() => { setTabActiva('precios'); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tabActiva === 'precios'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            🏷️ Listas & Descuentos por Volumen
          </button>
          <button
            type="button"
            onClick={() => { setTabActiva('catalogos'); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tabActiva === 'catalogos'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            💳 Medios de Pago & Rubros
          </button>
          <button
            type="button"
            onClick={() => { setTabActiva('bitacora'); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              tabActiva === 'bitacora'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            📊 Bitácora Piloto ({diasSinDiferencias} días OK)
          </button>
        </div>

        {mensaje && (
          <div
            data-testid="config-mensaje-ok"
            className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-900 flex items-center justify-between"
          >
            <span>{mensaje}</span>
            <button
              type="button"
              onClick={() => { setMensaje(null); }}
              className="text-emerald-700 hover:text-emerald-900 text-sm font-black"
            >
              ✕
            </button>
          </div>
        )}

        {errorMsg && (
          <div
            data-testid="config-error-msg"
            className="mt-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs font-bold text-rose-900 flex items-center justify-between"
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => { setErrorMsg(null); }}
              className="text-rose-700 hover:text-rose-900 text-sm font-black"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* PESTAÑA 1: EMPRESA & BRANDING */}
      {tabActiva === 'empresa' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Formulario */}
          <div className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
              <span>🏛️</span> Datos Comerciales, Fiscales y de Contacto
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              Esta información se utiliza para encabezados de tickets, facturas
              electrónicas y presupuestos emitidos.
            </p>

            <form onSubmit={(e) => { void guardarEmpresa(e); }} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nombre de Fantasía / Comercial *
                  </label>
                  <input
                    type="text"
                    value={nombreComercial}
                    onChange={(e) => { setNombreComercial(e.target.value); }}
                    placeholder="Ej: Ferretería El Tornillo"
                    required
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Razón Social
                  </label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={(e) => { setRazonSocial(e.target.value); }}
                    placeholder="Ej: El Tornillo S.R.L."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    CUIT
                  </label>
                  <input
                    type="text"
                    value={cuit}
                    onChange={(e) => { setCuit(e.target.value); }}
                    placeholder="Ej: 30-71234567-9"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Condición Frente al IVA
                  </label>
                  <select
                    value={condicionIva}
                    onChange={(e) => { setCondicionIva(
                        e.target.value as
                          | 'responsable_inscripto'
                          | 'monotributo'
                          | 'exento'
                          | 'consumidor_final',
                      ); }
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none bg-white"
                  >
                    <option value="responsable_inscripto">
                      Responsable Inscripto
                    </option>
                    <option value="monotributo">Monotributo</option>
                    <option value="exento">Exento</option>
                    <option value="consumidor_final">Consumidor Final</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Ingresos Brutos (IIBB)
                  </label>
                  <input
                    type="text"
                    value={iibb}
                    onChange={(e) => { setIibb(e.target.value); }}
                    placeholder="Ej: 901-123456-7"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Inicio de Actividades
                  </label>
                  <input
                    type="date"
                    value={inicioActividades}
                    onChange={(e) => { setInicioActividades(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Teléfono de Contacto
                  </label>
                  <input
                    type="text"
                    value={telefono}
                    onChange={(e) => { setTelefono(e.target.value); }}
                    placeholder="Ej: +54 376 4123456"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Email Comercial
                  </label>
                  <input
                    type="email"
                    value={emailEmpresa}
                    onChange={(e) => { setEmailEmpresa(e.target.value); }}
                    placeholder="contacto@ferreteria.com"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Domicilio Comercial
                </label>
                <input
                  type="text"
                  value={domicilioComercial}
                  onChange={(e) => { setDomicilioComercial(e.target.value); }}
                  placeholder="Ej: Av. San Martín 1234, Posadas, Misiones"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* Logo */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                <label className="block text-xs font-bold text-slate-900">
                  Logo de la Empresa (Para Tickets y Facturas)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      URL Directa de la Imagen
                    </label>
                    <input
                      type="url"
                      value={logoUrl.startsWith('data:') ? '' : logoUrl}
                      onChange={(e) => { setLogoUrl(e.target.value); }}
                      placeholder="https://ejemplo.com/logo.png"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      O subir archivo desde el equipo
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={procesarLogoLocal}
                      className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white hover:file:bg-slate-800 cursor-pointer"
                    />
                  </div>
                </div>
                {logoUrl && (
                  <div className="flex items-center gap-3 pt-2">
                    <img
                      src={logoUrl}
                      alt="Logo empresa"
                      className="h-12 w-auto max-w-[150px] object-contain rounded border border-slate-200 bg-white p-1"
                    />
                    <button
                      type="button"
                      onClick={() => { setLogoUrl(''); }}
                      className="text-xs text-rose-600 hover:text-rose-800 font-bold"
                    >
                      Eliminar Logo
                    </button>
                  </div>
                )}
              </div>

              {/* Leyenda de Tickets */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Leyenda al Pie de Tickets
                </label>
                <textarea
                  rows={3}
                  value={leyendaTicket}
                  onChange={(e) => { setLeyendaTicket(e.target.value); }}
                  placeholder="Ej: ¡Gracias por su compra! Los cambios se realizan dentro de los 30 días presentando este ticket."
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium focus:border-slate-900 focus:outline-none"
                />
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Este mensaje aparecerá impreso al final de cada ticket térmico entregado a los clientes.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={cargandoEmpresa}
                  className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white shadow hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Guardar Datos de la Empresa
                </button>
              </div>
            </form>
          </div>

          {/* Previsualizador en Vivo de Ticket */}
          <div className="rounded-2xl bg-slate-100 p-6 shadow-sm border border-slate-300 flex flex-col items-center">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 mb-4 flex items-center gap-1.5">
              <span>🧾</span> Previsualización del Ticket Térmico
            </h4>

            {/* Simulación de papel térmico */}
            <div className="w-full max-w-[280px] bg-white p-5 rounded-lg shadow border border-slate-300 font-mono text-xs text-slate-800 space-y-3 leading-tight">
              {/* Logo / Encabezado */}
              <div className="text-center space-y-1">
                {logoUrl ? (
                  <div className="flex justify-center mb-1">
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="max-h-12 max-w-[140px] object-contain"
                    />
                  </div>
                ) : null}
                <div className="font-bold text-sm tracking-wide">
                  {nombreComercial || 'MI FERRETERÍA'}
                </div>
                {razonSocial && (
                  <div className="text-[10px] text-slate-600">{razonSocial}</div>
                )}
                {cuit && (
                  <div className="text-[10px] text-slate-600">CUIT: {cuit}</div>
                )}
                {domicilioComercial && (
                  <div className="text-[10px] text-slate-600">
                    {domicilioComercial}
                  </div>
                )}
                {telefono && (
                  <div className="text-[10px] text-slate-600">
                    Tel: {telefono}
                  </div>
                )}
                <div className="text-[10px] text-slate-500 uppercase">
                  IVA: {condicionIva.replace('_', ' ')}
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 my-2"></div>

              {/* Datos de muestra */}
              <div className="text-[11px] space-y-0.5">
                <div className="flex justify-between">
                  <span>Ticket N°:</span>
                  <span className="font-bold">#0001-000042</span>
                </div>
                <div className="flex justify-between">
                  <span>Fecha:</span>
                  <span>{new Date().toLocaleDateString('es-AR')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cajero:</span>
                  <span>Juan (Mostrador)</span>
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 my-2"></div>

              {/* Items muestra */}
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>2 x Tornillo Fixx 4x40</span>
                  <span>$ 2.400,00</span>
                </div>
                <div className="flex justify-between">
                  <span>1 x Cinta Aisladora 3M</span>
                  <span>$ 1.850,00</span>
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 my-2"></div>

              {/* Total */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm font-black">
                  <span>TOTAL:</span>
                  <span>$ 4.250,00</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>Medio de Cobro:</span>
                  <span className="font-bold">Efectivo</span>
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 my-2"></div>

              {/* Leyenda configurable */}
              <div className="text-center text-[10px] text-slate-600 italic px-1 pt-1">
                {leyendaTicket ||
                  '¡Muchas gracias por su compra! Comprobante de control.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: GESTIÓN DE USUARIOS */}
      {tabActiva === 'usuarios' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Personal y Usuarios del Sistema {cargandoUsuarios && <span className="text-xs text-slate-400 font-normal">(actualizando...)</span>}
              </h3>
              <p className="text-xs text-slate-500">
                Creación de cuentas, asignación de roles (Dueño, Encargado, Cajero) y restablecimiento de claves.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setUsuarioEditandoId(null);
                setUsuarioNombre('');
                setUsuarioEmail('');
                setUsuarioPassword('');
                setUsuarioRol('cajero');
                setUsuarioActivo(true);
                setMostrarModalUsuario(true);
              }}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            >
              <span>+</span> Nuevo Usuario
            </button>
          </div>

          {/* Tabla de Usuarios */}
          <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Nombre</th>
                    <th className="px-5 py-3.5">Email</th>
                    <th className="px-5 py-3.5">Rol de Acceso</th>
                    <th className="px-5 py-3.5">Estado</th>
                    <th className="px-5 py-3.5">Último Ingreso</th>
                    <th className="px-5 py-3.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {usuarios.map((u) => {
                    const rolBadgeColor =
                      u.rol === 'dueno'
                        ? 'bg-purple-100 text-purple-900 border-purple-200'
                        : u.rol === 'encargado'
                          ? 'bg-amber-100 text-amber-900 border-amber-200'
                          : 'bg-blue-100 text-blue-900 border-blue-200';

                    return (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3.5 font-bold text-slate-900">
                          {u.nombre}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-slate-600">
                          {u.email || '-'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase border ${rolBadgeColor}`}
                          >
                            {u.rol}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            type="button"
                            onClick={() => { void toggleActivoUsuario(u); }}
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              u.activo
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {u.activo ? '● Activo' : '○ Inactivo'}
                          </button>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500">
                          {u.ultimoIngreso
                            ? new Date(u.ultimoIngreso).toLocaleString('es-AR')
                            : 'Nunca'}
                        </td>
                        <td className="px-5 py-3.5 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setUsuarioEditandoId(u.id);
                              setUsuarioNombre(u.nombre);
                              setUsuarioEmail(u.email || '');
                              setUsuarioPassword('');
                              setUsuarioRol(u.rol);
                              setUsuarioActivo(u.activo);
                              setMostrarModalUsuario(true);
                            }}
                            className="text-xs font-bold text-slate-700 hover:text-slate-900 underline"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUsuarioPasswordModalId(u.id);
                              setUsuarioPasswordModalNombre(u.nombre);
                              setNuevaPasswordDirecta('');
                            }}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
                          >
                            Clave
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {usuarios.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-8 text-center text-slate-500"
                      >
                        No hay usuarios cargados en este negocio.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modal Crear / Editar Usuario */}
          {mostrarModalUsuario && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <h4 className="text-base font-bold text-slate-900">
                    {usuarioEditandoId ? 'Editar Usuario' : 'Nuevo Usuario'}
                  </h4>
                  <button
                    type="button"
                    onClick={() => { setMostrarModalUsuario(false); }}
                    className="text-slate-400 hover:text-slate-700 font-bold text-lg"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={(e) => { void guardarUsuario(e); }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      value={usuarioNombre}
                      onChange={(e) => { setUsuarioNombre(e.target.value); }}
                      placeholder="Ej: Marcelo Gómez"
                      required
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Correo Electrónico (Login) *
                    </label>
                    <input
                      type="email"
                      value={usuarioEmail}
                      onChange={(e) => { setUsuarioEmail(e.target.value); }}
                      placeholder="marcelo@ferreteria.local"
                      required
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Rol de Permisos *
                    </label>
                    <select
                      value={usuarioRol}
                      onChange={(e) => { setUsuarioRol(e.target.value as RolUsuario); }
                      }
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none bg-white"
                    >
                      <option value="cajero">
                        Cajero (Vende, cobra y registra egresos de turno)
                      </option>
                      <option value="encargado">
                        Encargado (Cierra turnos, arqueo, anula y reportes)
                      </option>
                      <option value="dueno">
                        Dueño (Control total, configuración y usuarios)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {usuarioEditandoId
                        ? 'Nueva Contraseña (dejar en blanco para no cambiar)'
                        : 'Contraseña de Acceso *'}
                    </label>
                    <input
                      type="password"
                      value={usuarioPassword}
                      onChange={(e) => { setUsuarioPassword(e.target.value); }}
                      placeholder={
                        usuarioEditandoId ? '••••••••' : 'Mínimo 6 caracteres'
                      }
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="check-activo"
                      checked={usuarioActivo}
                      onChange={(e) => { setUsuarioActivo(e.target.checked); }}
                      className="rounded border-slate-300 text-slate-900 focus:ring-0"
                    />
                    <label
                      htmlFor="check-activo"
                      className="text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      Usuario habilitado para iniciar sesión (Activo)
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => { setMostrarModalUsuario(false); }}
                      className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow hover:bg-slate-800"
                    >
                      Guardar Usuario
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal Cambiar Clave Rápido */}
          {usuarioPasswordModalId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
              <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
                <h4 className="text-base font-bold text-slate-900 mb-1">
                  Restablecer Contraseña
                </h4>
                <p className="text-xs text-slate-500 mb-4">
                  Usuario: <strong>{usuarioPasswordModalNombre}</strong>
                </p>

                <form onSubmit={(e) => { void guardarNuevaPassword(e); }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nueva Contraseña *
                    </label>
                    <input
                      type="password"
                      value={nuevaPasswordDirecta}
                      onChange={(e) => { setNuevaPasswordDirecta(e.target.value); }}
                      placeholder="Mínimo 6 caracteres"
                      required
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => { setUsuarioPasswordModalId(null); }}
                      className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700"
                    >
                      Actualizar Clave
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PESTAÑA 3: MATRIZ DE ROLES & PERMISOS */}
      {tabActiva === 'permisos' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Matriz de Permisos y Niveles de Autorización
            </h3>
            <p className="text-xs text-slate-500">
              Garantiza segregación de funciones según las reglas inviolables del negocio.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Funcionalidad / Módulo</th>
                  <th className="px-5 py-3.5 text-center bg-blue-50/50 text-blue-900">
                    Cajero
                  </th>
                  <th className="px-5 py-3.5 text-center bg-amber-50/50 text-amber-900">
                    Encargado
                  </th>
                  <th className="px-5 py-3.5 text-center bg-purple-50/50 text-purple-900">
                    Dueño
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Ventas en mostrador y cobro multimoneda
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Apertura de turno y egresos menores autorizados
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Cierre de turno con arqueo físico de efectivo
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Anulación de ventas (reversión inmutable)
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Emisión de facturas fiscales (A, B, C) y notas de crédito
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Gestión de Cuentas Corrientes (Clientes y Proveedores)
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Gestión de Stock, Kardex, precios y proveedores
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Libro Diario Contable y Cierre de Ejercicio
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-semibold">
                    Configuración de empresa, CUIT, logo y usuarios
                  </td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-slate-400">✗</td>
                  <td className="px-5 py-3 text-center text-emerald-600 font-bold">
                    ✓
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PESTAÑA 4: MEDIOS DE PAGO & CATÁLOGOS */}
      {/* PESTAÑA: LISTAS DE PRECIOS Y REGLAS DE VOLUMEN */}
      {tabActiva === 'precios' && (
        <GestionListasYReglas
          token={token}
          rolActivo={rolActivo}
          rubros={rubros}
          onListasActualizadas={() => {
            void onCatalogosActualizados();
          }}
        />
      )}

      {tabActiva === 'catalogos' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Medios de Cobro */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-4">
              <h3 className="text-base font-bold text-slate-900">
                Medios de Cobro y Comisiones
              </h3>
              <p className="text-xs text-slate-500">
                Los días de acreditación alimentan el flujo de caja proyectado.
              </p>

              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Nombre (ej: Tarjeta Naranja Plan Z)"
                  value={medioNombre}
                  onChange={(e) => { setMedioNombre(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">
                      Días Acreditación
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={medioDiasAcreditacion}
                      onChange={(e) => { setMedioDiasAcreditacion(e.target.value); }}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">
                      Comisión %
                    </label>
                    <input
                      type="text"
                      placeholder="0.00"
                      value={medioComisionPct}
                      onChange={(e) => { setMedioComisionPct(e.target.value); }}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="medio-es-efectivo"
                    checked={medioEsEfectivo}
                    onChange={(e) => { setMedioEsEfectivo(e.target.checked); }}
                    className="rounded border-slate-300 text-slate-900"
                  />
                  <label
                    htmlFor="medio-es-efectivo"
                    className="text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    ¿Es Efectivo físico en cajón?
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => { void guardarMedioPago(); }}
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800"
                >
                  {medioEditId ? 'Actualizar Medio' : 'Agregar Medio de Cobro'}
                </button>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 max-h-56 overflow-y-auto">
                {mediosPago.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-800">{m.nombre}</span>
                      <span className="ml-2 text-slate-500">
                        {m.esEfectivo
                          ? '(Cajón)'
                          : `(${m.diasAcreditacion}d · ${m.comisionPct}%)`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMedioEditId(m.id);
                        setMedioNombre(m.nombre);
                        setMedioEsEfectivo(m.esEfectivo);
                        setMedioDiasAcreditacion(String(m.diasAcreditacion));
                        setMedioComisionPct(m.comisionPct);
                      }}
                      className="text-indigo-600 hover:text-indigo-800 font-bold"
                    >
                      Editar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Rubros y Categorías */}
            <div className="space-y-6">
              {/* Rubros */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-3">
                <h3 className="text-base font-bold text-slate-900">
                  Rubros de Artículos
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nuevo rubro (ej: Bulonería)"
                    value={nuevoRubroNombre}
                    onChange={(e) => { setNuevoRubroNombre(e.target.value); }}
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { void guardarRubro(); }}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow hover:bg-slate-800"
                  >
                    + Rubro
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {rubros.map((r) => (
                    <span
                      key={r.id}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                    >
                      {r.nombre}
                    </span>
                  ))}
                </div>
              </div>

              {/* Categorías */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-3">
                <h3 className="text-base font-bold text-slate-900">
                  Categorías de Movimiento
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nueva categoría (ej: Flete)"
                    value={nuevaCategoriaNombre}
                    onChange={(e) => { setNuevaCategoriaNombre(e.target.value); }}
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                  <select
                    value={nuevaCategoriaTipo}
                    onChange={(e) => { setNuevaCategoriaTipo(
                        e.target.value as 'ingreso' | 'egreso',
                      ); }
                    }
                    className="rounded-xl border border-slate-300 px-2 py-2 text-xs bg-white"
                  >
                    <option value="egreso">Egreso</option>
                    <option value="ingreso">Ingreso</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => { void guardarCategoria(); }}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow hover:bg-slate-800"
                  >
                    + Categoría
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {categorias.map((c) => (
                    <span
                      key={c.id}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                        c.tipo === 'egreso'
                          ? 'bg-rose-50 text-rose-700 border border-rose-100'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      }`}
                    >
                      {c.nombre} ({c.tipo})
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 5: BITÁCORA PILOTO EN PARALELO */}
      {tabActiva === 'bitacora' && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Bitácora de Conciliación en Paralelo (Sistema vs. Planilla)
            </h3>
            <p className="text-xs text-slate-500">
              Registrá el arqueo del día comparando el efectivo esperado por el
              sistema contra el resultado de la planilla Excel / cuaderno.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Fecha
              </label>
              <input
                type="date"
                value={fechaPiloto}
                onChange={(e) => { setFechaPiloto(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Efectivo Planilla ($)
              </label>
              <input
                type="text"
                placeholder="5800.00"
                value={efectivoPlanillaInput}
                onChange={(e) => { setEfectivoPlanillaInput(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Observación
              </label>
              <input
                type="text"
                placeholder="Sin diferencias"
                value={observacionPilotoInput}
                onChange={(e) => { setObservacionPilotoInput(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={registrarComparacionPiloto}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-800"
              >
                Registrar Conciliación
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3 text-right">Efectivo Sistema</th>
                  <th className="px-4 py-3 text-right">Efectivo Planilla</th>
                  <th className="px-4 py-3 text-right">Diferencia</th>
                  <th className="px-4 py-3">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {bitacoraPiloto.map((r) => (
                  <tr key={r.fecha} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold">{r.fecha}</td>
                    <td className="px-4 py-3 text-right">
                      {formatearPesos(r.efectivoSistema)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatearPesos(r.efectivoPlanilla)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-bold ${
                        r.diferenciaConPlanilla === '0.00'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {formatearPesos(r.diferenciaConPlanilla)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.observacion}</td>
                  </tr>
                ))}
                {bitacoraPiloto.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-slate-400"
                    >
                      Aún no hay comparaciones registradas en la bitácora.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
