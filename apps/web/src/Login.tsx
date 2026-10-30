import { useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import type { UsuarioSesion, LoginResponse } from '@ferreteria/shared';
import { apiUrl } from './api-url.js';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LoginProps {
  onLoginExitoso: (token: string, usuario: UsuarioSesion) => void;
}

export function Login({ onLoginExitoso }: LoginProps): ReactElement {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [promptInstalacion, setPromptInstalacion] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPromptInstalacion(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstalarApp = async () => {
    if (!promptInstalacion) {
      alert(
        'Para instalar en iPhone/iPad: tocá el botón Compartir y seleccioná "Agregar a pantalla de inicio".\nEn Chrome: tocá el menú de tres puntos arriba a la derecha y seleccioná "Instalar aplicación".',
      );
      return;
    }
    await promptInstalacion.prompt();
    const choice = await promptInstalacion.userChoice;
    if (choice.outcome === 'accepted') {
      setPromptInstalacion(null);
    }
  };

  const handleSubmit = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!usuario.trim() || !password.trim()) {
      setErrorMensaje('Completá tu usuario y contraseña para ingresar.');
      return;
    }

    setCargando(true);
    setErrorMensaje(null);

    try {
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usuario: usuario.trim(),
          password,
        }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          res.ok
            ? 'Respuesta inesperada del servidor.'
            : `El servidor no pudo procesar la solicitud (código ${res.status}). Verificá que la API esté activa.`,
        );
      }

      const data = (await res.json()) as LoginResponse | { error?: string };

      if (!res.ok) {
        const errorData = data as { error?: string };
        throw new Error(errorData.error ?? 'Credenciales incorrectas');
      }

      const datos = data as LoginResponse;
      onLoginExitoso(datos.token, datos.usuario);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMensaje(err.message);
      } else {
        setErrorMensaje('No se pudo iniciar sesión. Comprobá tu conexión.');
      }
    } finally {
      setCargando(false);
    }
  };

  const seleccionarDemo = (userDemo: string, passDemo: string): void => {
    setUsuario(userDemo);
    setPassword(passDemo);
    setErrorMensaje(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo y Encabezado */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 text-3xl shadow-lg shadow-amber-500/20 mb-3">
            🛠️
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Sistema de Gestión
          </h1>
          <p className="text-sm font-medium text-slate-400 mt-1">
            Ferretería, Corralón & Comercios Similares
          </p>
        </div>

        {/* Tarjeta de Formulario */}
        <div className="rounded-2xl bg-white/95 backdrop-blur-md p-6 sm:p-8 shadow-2xl border border-white/20">
          <div className="border-b border-slate-100 pb-4 mb-5">
            <h2 className="text-lg font-bold text-slate-900">
              Ingreso de Usuarios
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ingresá con tu usuario o correo y contraseña asignada
            </p>
          </div>

          {errorMensaje && (
            <div
              data-testid="mensaje-error-login"
              className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800 flex items-center gap-2"
            >
              <span>⚠️</span>
              <span>{errorMensaje}</span>
            </div>
          )}

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div>
              <label
                htmlFor="input-login-usuario"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
              >
                Usuario o Correo
              </label>
              <input
                id="input-login-usuario"
                data-testid="input-login-usuario"
                type="text"
                autoComplete="username"
                placeholder="Ej: cajero@ferreteria.local o Juan"
                value={usuario}
                onChange={(e) => {
                  setUsuario(e.target.value);
                }}
                disabled={cargando}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 disabled:bg-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="input-login-password"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
              >
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="input-login-password"
                  data-testid="input-login-password"
                  type={mostrarPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  disabled={cargando}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 disabled:bg-slate-100 pr-10"
                />
                <button
                  type="button"
                  data-testid="btn-toggle-password"
                  onClick={() => {
                    setMostrarPassword((prev) => !prev);
                  }}
                  tabIndex={-1}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-sm px-1"
                >
                  {mostrarPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              data-testid="btn-iniciar-sesion"
              disabled={cargando}
              className="mt-2 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-md shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-98 disabled:opacity-50"
            >
              {cargando ? 'Ingresando...' : 'Iniciar Sesión'}
            </button>

            {promptInstalacion && (
              <button
                type="button"
                onClick={() => { void handleInstalarApp(); }}
                className="mt-3 w-full rounded-xl bg-emerald-50 border border-emerald-300 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition flex items-center justify-center gap-2"
              >
                <span>📲</span>
                <span>Instalar como App en este dispositivo</span>
              </button>
            )}
          </form>

          {/* Accesos Rápidos para Prueba / Piloto */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 text-center">
              Perfiles de acceso rápido (Prueba)
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                data-testid="btn-demo-cajero"
                onClick={() => {
                  seleccionarDemo('cajero@ferreteria.local', '123456');
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-blue-50 hover:border-blue-300 transition"
              >
                <div className="font-bold text-slate-800">🛒 Cajero</div>
                <div className="text-[10px] text-slate-500">123456</div>
              </button>
              <button
                type="button"
                data-testid="btn-demo-encargado"
                onClick={() => {
                  seleccionarDemo('encargada@ferreteria.local', '123456');
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-emerald-50 hover:border-emerald-300 transition"
              >
                <div className="font-bold text-slate-800">📋 Encargada</div>
                <div className="text-[10px] text-slate-500">123456</div>
              </button>
              <button
                type="button"
                data-testid="btn-demo-dueno"
                onClick={() => {
                  seleccionarDemo('dueno@ferreteria.local', 'admin123');
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-amber-50 hover:border-amber-300 transition"
              >
                <div className="font-bold text-slate-800">👑 Dueño</div>
                <div className="text-[10px] text-slate-500">admin123</div>
              </button>
            </div>
          </div>
        </div>

        {/* Pie de pantalla */}
        <div className="mt-6 text-center text-xs text-slate-400">
          Modo online / offline integrado · Sesión protegida con roles
        </div>
      </div>
    </div>
  );
}
