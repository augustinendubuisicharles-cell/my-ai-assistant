// The first job search right after someone confirms, so they don't wait for the next
// morning. The search itself runs in GitHub Actions (job_alerts/send_daily.py), so we
// start that workflow for just this subscriber. Needs GH_TOKEN: a fine-grained GitHub
// token with "Actions: read and write" on this repository (JOB_ALERTS_GITHUB_TOKEN secret).
export const enabled = (env) => Boolean((env.GH_TOKEN || "").trim() && (env.GITHUB_REPO || "").trim());

export const start = (env, email) => dispatch(env, { only_email: email, first: "1" }, "first search");

// The morning run for everyone, started by the Worker's 06:00 UTC cron trigger: GitHub's own
// schedule can start hours late, so it is only a fallback (send_daily skips anyone already emailed today).
export const daily = (env) => dispatch(env, { first: "0" }, "daily run");

async function dispatch(env, inputs, what, tries = 2) {
  if (!enabled(env)) return false;
  for (let i = 0; i < tries; i++) if (await dispatchOnce(env, inputs, what)) return true;
  return false;
}

async function dispatchOnce(env, inputs, what) {
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO.trim()}/actions/workflows/job_alerts_daily.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_TOKEN.trim()}`, accept: "application/vnd.github+json",
                 "user-agent": "jobalert-worker", "content-type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs }),
    });
    if (r.ok) return true;
    console.log(`[${what}] GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.log(`[${what}] ${e}`);
  }
  return false;
}
