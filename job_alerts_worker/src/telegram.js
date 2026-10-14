// Telegram alerts for paying members. People connect from their manage page via
// t.me/<bot>?start=<their token>; Telegram then calls our webhook with "/start <token>".
// JOB_ALERTS_TELEGRAM_TOKEN is the bot's token; the webhook secret is derived from it,
// so nothing else needs setting (the deploy workflow registers the webhook).
const api = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}),
  });

export const enabled = (env) => Boolean((env.TELEGRAM_TOKEN || "").trim());

let username = null;
export async function botUsername(env) {
  if (!enabled(env)) return null;
  if (!username) {
    try {
      username = (await (await api(env, "getMe")).json()).result?.username || null;
    } catch (e) {
      console.log(`[telegram getMe] ${e}`);
    }
  }
  return username;
}

// Must match the secret_token the deploy workflow passes to setWebhook.
export async function webhookSecret(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jobalert-webhook:${env.TELEGRAM_TOKEN}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

export const send = (env, chatId, text) => api(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
