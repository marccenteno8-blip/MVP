// Helpers compartidos para hablar con la Cloud API de Meta.
// Los usan tanto whatsapp-webhook (conversación) como whatsapp-reminders
// (mensajes iniciados por el negocio), para no duplicar la llamada fetch.

const GRAPH_VERSION = "v19.0";

function endpoint() {
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;
}

function authHeaders() {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

// Mensaje de texto libre. Solo válido dentro de la ventana de 24h desde
// el último mensaje del cliente (conversación ya abierta, p.ej. el bot
// de reservas respondiendo a alguien que acaba de escribir).
export async function sendWhatsAppMessage(to: string, text: string) {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });
  if (!res.ok) {
    console.error("sendWhatsAppMessage failed", res.status, await res.text());
  }
  return res;
}

// Mensaje de plantilla. Es el único tipo permitido para escribir primero
// (p.ej. un recordatorio), fuera de la ventana de 24h. La plantilla debe
// existir y estar aprobada en Meta > WhatsApp > Message Templates, con el
// mismo nombre, idioma y número de variables que se pasan aquí.
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
) {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    console.error("sendWhatsAppTemplate failed", res.status, await res.text());
  }
  return res;
}
