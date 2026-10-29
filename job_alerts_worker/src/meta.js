// Meta (Facebook) Pixel and Conversions API, for the marketer's ads: PageView on every page, CompleteRegistration when
// someone confirms their email, Purchase when a payment is confirmed. The browser event and the server event for the
// same thing share an event ID (reg-<subscriber id>, pay-<payment reference>), so Meta counts it once.
// Off unless META_PIXEL_ID is set. The server events also need META_CAPI_TOKEN; META_TEST_EVENT_CODE sends them to
// Events Manager's "Test events" tab instead of the live data.
const GRAPH = "https://graph.facebook.com/v23.0";

export const pixelId = (env) => {
  const id = String(env.META_PIXEL_ID || "").trim();
  return /^\d{5,20}$/.test(id) ? id : "";
};

export const registrationId = (subscriberId) => `reg-${subscriberId}`;
export const purchaseId = (reference) => `pay-${reference}`;

// The Pixel for a page: PageView, then any events the page reports (each once per browser, by event ID).
export function pixelScript(id, events = []) {
  if (!id) return "";
  const track = events.map((e) => `once(${JSON.stringify(e.name)},${JSON.stringify(e.params || {})},${JSON.stringify(e.eventId)});`).join("");
  return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('track','PageView');
function once(n,p,id){try{if(localStorage.getItem('fbq_'+id))return;localStorage.setItem('fbq_'+id,'1')}catch(x){}fbq('track',n,p,{eventID:id})}
${track}</script>
<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"></noscript>`;
}

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cookie = (request, name) => (request?.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "";

// One server event. `request` is the visitor's own request (for their IP, browser and Meta cookies); leave it out
// for events we learn about from elsewhere (a payment webhook), so Paystack's server isn't sent as the buyer.
// Never throws: tracking must not break a sign-up or a payment.
export async function sendEvent(env, { name, eventId, email, subscriberId, url, request = null, value = null, currency = null }) {
  const id = pixelId(env);
  const token = String(env.META_CAPI_TOKEN || "").trim();
  if (!id || !token) return false;
  try {
    const user = {};
    if (email) user.em = [await sha256(String(email).trim().toLowerCase())];
    if (subscriberId) user.external_id = [await sha256(String(subscriberId))];
    if (request) {
      const ip = request.headers.get("cf-connecting-ip");
      const agent = request.headers.get("user-agent");
      if (ip) user.client_ip_address = ip;
      if (agent) user.client_user_agent = agent;
      if (cookie(request, "_fbp")) user.fbp = cookie(request, "_fbp");
      if (cookie(request, "_fbc")) user.fbc = cookie(request, "_fbc");
    }
    const event = { event_name: name, event_time: Math.floor(Date.now() / 1000), event_id: eventId, action_source: "website",
      event_source_url: url, user_data: user };
    if (value !== null) event.custom_data = { value, currency };
    const body = { data: [event] };
    if (String(env.META_TEST_EVENT_CODE || "").trim()) body.test_event_code = String(env.META_TEST_EVENT_CODE).trim();
    const r = await fetch(`${GRAPH}/${id}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status >= 300) console.log(`[meta] ${name} ${eventId}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status < 300;
  } catch (e) {
    console.log(`[meta] ${name} ${eventId}: ${e}`);
    return false;
  }
}
