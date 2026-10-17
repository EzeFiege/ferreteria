/**
 * Resuelve la URL de un endpoint de la API:
 * - En desarrollo local (sin VITE_API_URL): conserva el prefijo `/api/...` para el proxy de Vite.
 * - En producción (con VITE_API_URL apuntando al servicio de Railway): reemplaza `/api` por la URL base de la API.
 */
export function apiUrl(endpoint: string): string {
  const envUrl = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env?.['VITE_API_URL']?.trim();

  if (!envUrl) {
    return endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  }

  const base = envUrl.replace(/\/+$/, '');
  const rutaSinPrefijoApi = endpoint.replace(/^\/api(?=\/|$)/, '');
  return `${base}${rutaSinPrefijoApi.startsWith('/') ? '' : '/'}${rutaSinPrefijoApi}`;
}
