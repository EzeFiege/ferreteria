/**
 * Utilidad para impresión de tickets térmicos de comanderas (58mm y 80mm).
 */

export interface ItemTicketTermico {
  cantidad: string;
  descripcion: string;
  precioUnitario: string;
  subtotal: string;
}

export interface DatosTicketTermico {
  nombreComercio: string;
  logoUrl?: string | undefined;
  cuitComercio?: string | undefined;
  direccionComercio?: string | undefined;
  telefonoComercio?: string | undefined;
  numeroTicket: string | number;
  fechaHora: string;
  cajeroNombre?: string | undefined;
  clienteNombre?: string | undefined;
  clienteDocumento?: string | undefined;
  items: ItemTicketTermico[];
  subtotal: string;
  descuento?: string | undefined;
  total: string;
  medioCobro: string;
  anchoPapelMm?: 58 | 80 | undefined;
}

export function imprimirTicketTermico(datos: DatosTicketTermico): void {
  const anchoMm = datos.anchoPapelMm ?? 80;
  const ventanaImpresion = window.open('', '_blank', 'width=460,height=650');
  if (!ventanaImpresion) {
    alert('Por favor habilitá las ventanas emergentes (popups) para imprimir tickets.');
    return;
  }

  const filasItemsHtml = datos.items
    .map(
      (it) => `
      <tr>
        <td style="text-align: left; padding: 2px 0; vertical-align: top;">
          <div>${it.descripcion}</div>
          ${
            parseFloat(it.cantidad) > 1
              ? `<div style="font-size: 10px; color: #555;">${it.cantidad} x $ ${it.precioUnitario}</div>`
              : ''
          }
        </td>
        <td style="text-align: right; padding: 2px 0; white-space: nowrap; vertical-align: top; font-weight: bold;">
          $ ${it.subtotal}
        </td>
      </tr>
    `,
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Ticket #${datos.numeroTicket}</title>
      <style>
        @page {
          size: ${anchoMm}mm auto;
          margin: 3mm 4mm;
        }
        * {
          box-sizing: border-box;
        }
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          line-height: 1.25;
          margin: 0;
          padding: 8px 6px;
          width: ${anchoMm === 58 ? '48mm' : '72mm'};
          max-width: ${anchoMm === 58 ? '48mm' : '72mm'};
          color: #000;
          background: #fff;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .no-print {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #0f172a;
          color: #fff;
          padding: 8px 10px;
          margin: -8px -6px 12px -6px;
          font-family: Arial, sans-serif;
          font-size: 11px;
        }
        .no-print button {
          background: #2563eb;
          color: #fff;
          border: none;
          padding: 5px 10px;
          border-radius: 4px;
          font-weight: bold;
          cursor: pointer;
          font-size: 11px;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .divider {
          border-top: 1px dashed #000;
          margin: 6px 0;
        }
        .double-divider {
          border-top: 2px solid #000;
          margin: 6px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        .total-box {
          font-size: 14px;
          font-weight: bold;
        }
        @media print {
          body {
            width: 100%;
            max-width: 100%;
            padding: 0;
            margin: 0;
          }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="no-print">
        <span>Ticket Mostrador</span>
        <div>
          <button onclick="window.print()">🖨️ Imprimir</button>
          <button onclick="window.close()" style="background:#64748b; margin-left:4px;">✕</button>
        </div>
      </div>

      ${
        datos.logoUrl
          ? `<div class="text-center" style="margin-bottom: 6px;">
              <img src="${datos.logoUrl}" alt="Logo" style="max-height: 48px; max-width: 140px; object-fit: contain;" />
            </div>`
          : ''
      }
      <div class="text-center font-bold" style="font-size: 14px; letter-spacing: 0.5px;">
        ${datos.nombreComercio}
      </div>
      ${
        datos.cuitComercio
          ? `<div class="text-center" style="font-size: 11px;">CUIT: ${datos.cuitComercio}</div>`
          : ''
      }
      ${
        datos.direccionComercio
          ? `<div class="text-center" style="font-size: 11px;">${datos.direccionComercio}</div>`
          : ''
      }
      ${
        datos.telefonoComercio
          ? `<div class="text-center" style="font-size: 11px;">Tel: ${datos.telefonoComercio}</div>`
          : ''
      }

      <div class="divider"></div>

      <div style="font-size: 11px;">
        <div><strong>Ticket Nº:</strong> #${datos.numeroTicket}</div>
        <div><strong>Fecha:</strong> ${datos.fechaHora}</div>
        ${
          datos.cajeroNombre
            ? `<div><strong>Atendió:</strong> ${datos.cajeroNombre}</div>`
            : ''
        }
        ${
          datos.clienteNombre
            ? `<div><strong>Cliente:</strong> ${datos.clienteNombre} ${
                datos.clienteDocumento ? `(${datos.clienteDocumento})` : ''
              }</div>`
            : ''
        }
      </div>

      <div class="divider"></div>

      <table>
        <thead>
          <tr style="border-bottom: 1px dashed #000; font-size: 11px;">
            <th style="text-align: left; padding-bottom: 4px;">Detalle</th>
            <th style="text-align: right; padding-bottom: 4px;">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${filasItemsHtml}
        </tbody>
      </table>

      <div class="double-divider"></div>

      <table>
        ${
          datos.descuento && parseFloat(datos.descuento) > 0
            ? `<tr>
                <td style="text-align: left;">Subtotal:</td>
                <td style="text-align: right;">$ ${datos.subtotal}</td>
              </tr>
              <tr>
                <td style="text-align: left;">Descuento:</td>
                <td style="text-align: right;">-$ ${datos.descuento}</td>
              </tr>`
            : ''
        }
        <tr class="total-box">
          <td style="text-align: left; padding: 4px 0;">TOTAL:</td>
          <td style="text-align: right; padding: 4px 0;">$ ${datos.total}</td>
        </tr>
        <tr>
          <td style="text-align: left; font-size: 11px;">Medio de Pago:</td>
          <td style="text-align: right; font-size: 11px; font-weight: bold;">${datos.medioCobro}</td>
        </tr>
      </table>

      <div class="divider"></div>

      <div class="text-center" style="font-size: 10px; color: #555; margin-top: 6px;">
        <div>¡Gracias por su compra!</div>
        <div style="margin-top: 2px;">Comprobante no fiscal - Ticket de control</div>
      </div>

      <script>
        window.addEventListener('load', function() {
          setTimeout(function() { window.print(); }, 200);
        });
      </script>
    </body>
    </html>
  `;

  ventanaImpresion.document.open();
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  ventanaImpresion.document.write(html);
  ventanaImpresion.document.close();
}
