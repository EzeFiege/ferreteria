export interface BrandingApp {
  nombre: string;
  logoUrl: string | null;
  negocioId?: string;
}

const STORAGE_KEY_BRANDING = 'ferreteria_branding_v1';

export function leerBrandingCache(): BrandingApp | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BRANDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrandingApp>;
    if (typeof parsed.nombre === 'string') {
      return {
        nombre: parsed.nombre,
        logoUrl: typeof parsed.logoUrl === 'string' && parsed.logoUrl.trim() ? parsed.logoUrl : null,
        ...(typeof parsed.negocioId === 'string' ? { negocioId: parsed.negocioId } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function guardarBrandingCache(branding: BrandingApp): void {
  try {
    localStorage.setItem(STORAGE_KEY_BRANDING, JSON.stringify(branding));
  } catch {
    // Si localStorage supera cuota con una imagen enorme, evitamos romper el flujo
  }
}

export function aplicarBrandingDocumento(
  nombre: string,
  logoUrl: string | null,
): void {
  if (typeof document === 'undefined') return;

  const nombreLimpio = nombre.trim();
  if (nombreLimpio) {
    document.title = `${nombreLimpio} — Gestión & Caja`;
  }

  const limpioUrl = logoUrl?.trim() || null;

  // Actualizar favicons dinámicamente
  const favicons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
  if (limpioUrl) {
    if (favicons.length === 0) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = limpioUrl;
      document.head.appendChild(link);
    } else {
      favicons.forEach((link, idx) => {
        if (idx === 0) {
          link.removeAttribute('type');
          link.removeAttribute('sizes');
          link.href = limpioUrl;
        } else {
          link.href = limpioUrl;
        }
      });
    }
  } else {
    favicons.forEach((link, idx) => {
      if (idx === 0) {
        link.type = 'image/svg+xml';
        link.removeAttribute('sizes');
        link.href = '/icons/icon.svg';
      } else {
        link.type = 'image/png';
        link.sizes = '192x192';
        link.href = '/icons/icon-192.png';
      }
    });
  }

  const appleIcon = document.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
  );
  if (appleIcon) {
    appleIcon.href = limpioUrl ?? '/icons/icon-192.png';
  }
}

export function procesarArchivoImagenLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(
        new Error(
          'El archivo seleccionado debe ser una imagen (PNG, JPG, SVG, WebP).',
        ),
      );
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('La imagen no debe superar los 10 MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('No se pudo leer el archivo de imagen seleccionado.'));
    };
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string' || !result) {
        reject(new Error('El archivo de imagen está vacío o es inválido.'));
        return;
      }

      if (file.type.includes('svg')) {
        resolve(result);
        return;
      }

      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 600;
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
        if (!ctx) {
          resolve(result);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        resolve(result);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}
