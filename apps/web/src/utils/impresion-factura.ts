/**
 * Utilidad para impresión de Comprobantes Fiscales Electrónicos ARCA / AFIP
 * (Factura A, B, C con CAE, Código QR y detalle completo de ítems).
 */

import type { ComprobanteFiscalDetalle } from '@ferreteria/shared';

export interface DatosEmisorFiscal {
  razonSocial: string;
  nombreFantasia?: string | undefined;
  cuit: string;
  iibb?: string | undefined;
  inicioActividades?: string | undefined;
  domicilio?: string | undefined;
  condicionIva?: string | undefined;
  telefono?: string | undefined;
  logoUrl?: string | undefined;
}

export interface OpcionesImpresionFactura {
  formato?: 'a4' | 'termico_80mm';
}

export function imprimirComprobanteFiscal(
  comprobante: ComprobanteFiscalDetalle,
  emisor: DatosEmisorFiscal,
  opciones: OpcionesImpresionFactura = {},
): void {
  const formato = opciones.formato ?? 'a4';
  const esTermico = formato === 'termico_80mm';

  const ventana = window.open('', '_blank', esTermico ? 'width=450,height=700' : 'width=900,height=900');
  if (!ventana) {
    alert('Por favor habilitá las ventanas emergentes (popups) para imprimir la factura.');
    return;
  }

  // Identificar letra y descripción del comprobante
  let letra = 'B';
  let tituloCmp = 'FACTURA B';
  if (comprobante.tipoComprobante.includes('factura_a')) {
    letra = 'A';
    tituloCmp = 'FACTURA A';
  } else if (comprobante.tipoComprobante.includes('factura_c')) {
    letra = 'C';
    tituloCmp = 'FACTURA C';
  } else if (comprobante.tipoComprobante.includes('nota_credito_a')) {
    letra = 'A';
    tituloCmp = 'NOTA DE CRÉDITO A';
  } else if (comprobante.tipoComprobante.includes('nota_credito_b')) {
    letra = 'B';
    tituloCmp = 'NOTA DE CRÉDITO B';
  } else if (comprobante.tipoComprobante.includes('nota_credito_c')) {
    letra = 'C';
    tituloCmp = 'NOTA DE CRÉDITO C';
  }

  const ptoVtaStr = String(comprobante.puntoVentaNumero).padStart(4, '0');
  const nroCmpStr = String(comprobante.numeroComprobante).padStart(8, '0');
  const qrUrl = comprobante.codigoQrArca
    ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(comprobante.codigoQrArca)}`
    : null;

  const items = comprobante.items ?? [];

  const itemsHtml = items.length > 0
    ? items
        .map(
          (it) => `
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">${it.codigo ?? '-'}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">${it.descripcion}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: center;">${it.cantidad} ${it.unidad}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: right;">$ ${it.precioUnitario}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: center;">${it.alicuotaIva}%</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: right; font-weight: bold;">$ ${it.subtotal}</td>
        </tr>
      `,
        )
        .join('')
    : `
      <tr>
        <td colspan="6" style="padding: 12px; text-align: center; color: #6b7280; font-size: 12px;">
          Detalle global por venta $ ${comprobante.total}
        </td>
      </tr>
    `;

  const htmlA4 = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${tituloCmp} Nº ${ptoVtaStr}-${nroCmpStr}</title>
      <style>
        @page {
          size: A4;
          margin: 12mm 15mm;
        }
        body {
          font-family: Arial, Helvetica, sans-serif;
          color: #111827;
          background: #fff;
          margin: 0;
          padding: 0;
          font-size: 12px;
          line-height: 1.35;
        }
        .factura-box {
          border: 2px solid #1f2937;
          border-radius: 6px;
          overflow: hidden;
        }
        .header {
          display: flex;
          position: relative;
          border-bottom: 2px solid #1f2937;
          background: #fafafa;
        }
        .header-emisor {
          flex: 1;
          padding: 16px;
          border-right: 1px solid #d1d5db;
        }
        .letra-badge {
          position: absolute;
          left: 50%;
          top: 0;
          transform: translateX(-50%);
          background: #fff;
          border-left: 2px solid #1f2937;
          border-right: 2px solid #1f2937;
          border-bottom: 2px solid #1f2937;
          border-radius: 0 0 6px 6px;
          width: 56px;
          height: 52px;
          text-align: center;
          padding-top: 4px;
        }
        .letra-badge .letra {
          font-size: 26px;
          font-weight: 900;
          line-height: 1;
        }
        .letra-badge .cod {
          font-size: 9px;
          font-weight: bold;
          color: #4b5563;
        }
        .header-comprobante {
          flex: 1;
          padding: 16px 16px 16px 40px;
        }
        .datos-cliente {
          padding: 12px 16px;
          border-bottom: 2px solid #1f2937;
          background: #f9fafb;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 16px;
        }
        table.items-table {
          width: 100%;
          border-collapse: collapse;
        }
        table.items-table th {
          background: #f3f4f6;
          padding: 8px;
          border-bottom: 2px solid #e5e7eb;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .totales-footer {
          display: flex;
          justify-content: space-between;
          padding: 16px;
          border-top: 2px solid #1f2937;
          background: #fafafa;
        }
        .cae-qr-box {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .totales-resumen {
          min-width: 260px;
        }
        .totales-resumen table {
          width: 100%;
        }
        .totales-resumen td {
          padding: 3px 0;
          font-size: 12px;
        }
        .total-destacado {
          font-size: 16px;
          font-weight: bold;
          border-top: 1px solid #111827;
          padding-top: 6px !important;
        }
        @media print {
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="factura-box">
        <!-- Encabezado con Letra Central -->
        <div class="header">
          <div class="letra-badge">
            <div class="letra">${letra}</div>
            <div class="cod">CÓD. ${String(comprobante.codigoAfip).padStart(2, '0')}</div>
          </div>
          
          <div class="header-emisor">
            ${emisor.logoUrl ? `<img src="${emisor.logoUrl}" alt="Logo" style="max-height: 45px; margin-bottom: 6px;" />` : ''}
            <div style="font-size: 18px; font-weight: bold; color: #111827;">${emisor.razonSocial}</div>
            ${emisor.nombreFantasia ? `<div style="font-size: 13px; color: #4b5563; font-weight: 600;">${emisor.nombreFantasia}</div>` : ''}
            <div style="margin-top: 6px; font-size: 11px; color: #4b5563;">
              ${emisor.domicilio ? `<div>${emisor.domicilio}</div>` : ''}
              ${emisor.telefono ? `<div>Tel: ${emisor.telefono}</div>` : ''}
              <div>Condición IVA: <strong>${emisor.condicionIva ?? 'IVA Responsable Inscripto'}</strong></div>
            </div>
          </div>

          <div class="header-comprobante">
            <div style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${tituloCmp}</div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">
              Punto de Venta: ${ptoVtaStr} &nbsp;&nbsp; Comp. Nro: ${nroCmpStr}
            </div>
            <div style="font-size: 12px; margin-top: 6px;">
              <strong>Fecha de Emisión:</strong> ${comprobante.fechaEmision}
            </div>
            <div style="font-size: 11px; margin-top: 6px; color: #4b5563;">
              <div><strong>CUIT Emisor:</strong> ${emisor.cuit}</div>
              <div><strong>Ingresos Brutos:</strong> ${emisor.iibb ?? emisor.cuit}</div>
              <div><strong>Fecha de Inicio de Actividades:</strong> ${emisor.inicioActividades ?? '-'}</div>
            </div>
          </div>
        </div>

        <!-- Datos del Cliente / Receptor -->
        <div class="datos-cliente">
          <div>
            <strong>Receptor:</strong> ${comprobante.razonSocialCliente}
          </div>
          <div>
            <strong>CUIT / DNI:</strong> ${comprobante.cuitCliente || 'Consumidor Final'}
          </div>
          <div>
            <strong>Condición frente al IVA:</strong> ${comprobante.condicionIvaCliente.toUpperCase().replace('_', ' ')}
          </div>
          <div>
            <strong>Condición de Venta:</strong> Contado / Mostrador
          </div>
        </div>

        <!-- Tabla de Ítems / Conceptos -->
        <table class="items-table">
          <thead>
            <tr>
              <th style="text-align: left; width: 12%;">Código</th>
              <th style="text-align: left;">Descripción</th>
              <th style="text-align: center; width: 12%;">Cantidad</th>
              <th style="text-align: right; width: 14%;">Precio Unit.</th>
              <th style="text-align: center; width: 10%;">Alíc. IVA</th>
              <th style="text-align: right; width: 16%;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <!-- Totales, CAE y QR Oficial ARCA -->
        <div class="totales-footer">
          <div class="cae-qr-box">
            ${qrUrl ? `<img src="${qrUrl}" alt="QR ARCA" style="width: 100px; height: 100px; border: 1px solid #d1d5db; padding: 4px; background: #fff;" />` : ''}
            <div>
              <div style="font-weight: 800; font-size: 13px; color: #1e3a8a;">
                Comprobante Autorizado por ARCA
              </div>
              <div style="margin-top: 4px; font-size: 12px;">
                <strong>CAE Nº:</strong> ${comprobante.cae ?? 'EN TRÁMITE / CONTINGENCIA'}
              </div>
              <div style="font-size: 12px;">
                <strong>Fecha de Vto. de CAE:</strong> ${comprobante.vencimientoCae ?? '-'}
              </div>
              <div style="font-size: 10px; color: #6b7280; margin-top: 4px;">
                Régimen de Facturación Electrónica RG AFIP / ARCA
              </div>
            </div>
          </div>

          <div class="totales-resumen">
            <table>
              ${
                letra === 'A'
                  ? `
                <tr>
                  <td>Importe Neto Gravado:</td>
                  <td style="text-align: right; font-weight: 600;">$ ${comprobante.subtotalNetoGravado}</td>
                </tr>
                <tr>
                  <td>IVA 21%:</td>
                  <td style="text-align: right;">$ ${comprobante.subtotalIva21}</td>
                </tr>
                ${
                  parseFloat(comprobante.subtotalIva105) > 0
                    ? `<tr><td>IVA 10.5%:</td><td style="text-align: right;">$ ${comprobante.subtotalIva105}</td></tr>`
                    : ''
                }
              `
                  : ''
              }
              <tr class="total-destacado">
                <td>Importe Total:</td>
                <td style="text-align: right;">$ ${comprobante.total}</td>
              </tr>
            </table>
          </div>
        </div>
      </div>

      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  ventana.document.documentElement.innerHTML = htmlA4;
  setTimeout(() => {
    ventana.print();
  }, 300);
}
