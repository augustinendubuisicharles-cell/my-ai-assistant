// The first job search right after someone confirms, so they don't wait for the next
// morning. The search itself runs in GitHub Actions (job_alerts/send_daily.py), so we
// start that workflow for just this subscriber. Needs GH_TOKEN: a fine-grained GitHub
// token with "Actions: read and write" on this repository (JOB_ALERTS_GITHUB_TOKEN secret).
export const enabled = (env) => Boolean((env.GH_TOKEN || "").trim() && (env.GITHUB_REPO || "").trim());

export async function start(env, email) {
  if (!enabled(env)) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO.trim()}/actions/workflows/job_alerts_daily.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_TOKEN.trim()}`, accept: "application/vnd.github+json",
                 "user-agent": "jobalert-worker", "content-type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { only_email: email, first: "1" } }),
    });
    if (r.ok) return true;
    console.log(`[first search] GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.log(`[first search] ${e}`);
  }
  return false;
}
