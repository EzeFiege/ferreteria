/**
 * Utilidad para exportación de datos tabulares a formato CSV / Excel.
 * Incluye BOM UTF-8 (\uFEFF) para compatibilidad total con Microsoft Excel en Windows.
 */

function escaparCampoCSV(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) {
    return '""';
  }
  const str = String(valor);
  // Si contiene comillas, punto y coma, comas o saltos de línea, se escapan las comillas y se envuelve
  if (str.includes('"') || str.includes(';') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function exportarACSV(
  nombreArchivo: string,
  columnas: string[],
  filas: (string | number | null | undefined)[][],
): void {
  // Usamos ';' como separador estándar de listas para configuración regional hispana/Excel
  const lineaEncabezados = columnas.map(escaparCampoCSV).join(';');
  const lineasDatos = filas.map((fila) => fila.map(escaparCampoCSV).join(';'));

  const contenidoCSV = `\uFEFF${lineaEncabezados}\r\n${lineasDatos.join('\r\n')}`;
  const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.setAttribute('download', `${nombreArchivo}.csv`);
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}
