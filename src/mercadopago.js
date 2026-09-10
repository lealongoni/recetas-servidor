const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function getAccessToken() {
  return (process.env.MP_ACCESS_TOKEN || '').trim();
}

function isConfigured() {
  const token = getAccessToken();
  return Boolean(token && token !== 'TU_MERCADO_PAGO_ACCESS_TOKEN');
}

function getClient() {
  const token = getAccessToken();
  if (token && token !== 'TU_MERCADO_PAGO_ACCESS_TOKEN') {
    return new MercadoPagoConfig({ accessToken: token });
  }
  return null;
}

async function crearPreferencia({ recetaId, pacienteNombre, monto, baseUrl }) {
  const client = getClient();
  if (!client) {
    console.log('[MercadoPago] Modo simulado (Token MP_ACCESS_TOKEN no configurado en entorno).');
    return {
      id: `mock-pref-${recetaId}`,
      init_point: `${baseUrl}/receta/${recetaId}?simular_mp=true`,
      isMock: true
    };
  }

  try {
    const preference = new Preference(client);
    const body = {
      items: [
        {
          id: recetaId,
          title: `Receta Médica - ${pacienteNombre}`,
          quantity: 1,
          unit_price: Number(monto),
          currency_id: process.env.MP_CURRENCY_ID || 'ARS'
        }
      ],
      back_urls: {
        success: `${baseUrl}/receta/${recetaId}?status=approved`,
        failure: `${baseUrl}/receta/${recetaId}?status=failure`,
        pending: `${baseUrl}/receta/${recetaId}?status=pending`
      },
      auto_return: 'approved',
      notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      external_reference: recetaId
    };

    const response = await preference.create({ body });
    return {
      id: response.id,
      init_point: response.init_point
    };
  } catch (error) {
    console.error('[MercadoPago] Error creando preferencia:', error);
    throw error;
  }
}

async function consultarPago(paymentId) {
  const client = getClient();
  if (!client) {
    return { status: 'approved' };
  }
  try {
    const payment = new Payment(client);
    const result = await payment.get({ id: paymentId });
    return result;
  } catch (error) {
    console.error('[MercadoPago] Error consultando pago:', error);
    throw error;
  }
}

module.exports = {
  isConfigured,
  crearPreferencia,
  consultarPago
};
