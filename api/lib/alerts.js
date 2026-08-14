// Alertas via webhook (Discord/Slack) e log dos últimos eventos, exibidos na
// página Sistema (/alerts). Módulo leve (sem dependências pesadas) para ser
// usado tanto pelos servidores de jogo (serverCtx) quanto pelos usuários/admins
// e pelo checker da stack.

const { withTimeout } = require('./helpers')
const { alertWebhookUrl } = require('./config')

const alertEvents = []

function pushAlertEvent(id, type, detail) {
  const event = { serverId: id, type, at: new Date().toISOString() }
  if (detail) event.detail = detail
  alertEvents.push(event)
  if (alertEvents.length > 20) {
    alertEvents.shift()
  }
}

async function sendAlert(text) {
  if (!alertWebhookUrl) return
  try {
    const isDiscord = /discord(app)?\.com\/api\/webhooks/i.test(alertWebhookUrl)
    await withTimeout(fetch(alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isDiscord ? { content: text } : { text })
    }), 5000)
  } catch (err) {
    console.error('Erro ao enviar alerta:', err.message)
  }
}

module.exports = {
  alertWebhookUrl,
  alertEvents,
  pushAlertEvent,
  sendAlert
}
