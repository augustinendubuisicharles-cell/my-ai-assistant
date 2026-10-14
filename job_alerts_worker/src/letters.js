// AI cover letters and tailored CVs for paying members: their pasted CV + the job advert ->
// a letter, or their CV rewritten for that job, to copy or download. Needs ANTHROPIC_API_KEY (GitHub secret JOB_ALERTS_ANTHROPIC_KEY).
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
export const PER_DAY = 10;      // of each kind (letters, CVs) per member per day: keeps costs predictable
export const MAX_CV = 15000;    // characters of pasted CV we keep

export const enabled = (env) => Boolean((env.ANTHROPIC_API_KEY || "").trim());

const SYSTEM = `You write cover letters for job seekers, most of them in Nigeria applying to remote jobs abroad.
Write one letter for the job below, using only facts from the applicant's CV: never invent experience,
employers, numbers or qualifications. 200 to 300 words, warm and confident, plain English, no clichés.
Open with "Dear Hiring Manager," and end with the applicant's name if the CV gives it.
Connect two or three specific things from the CV to what the job needs. Reply with the letter only.`;

const CV_SYSTEM = `You tailor CVs for job seekers, most of them in Nigeria applying to remote jobs abroad.
Rewrite the applicant's CV for the job below so a recruiter (and their screening software) sees the fit at once.
Use only facts from the CV: never invent experience, employers, dates, numbers, tools or qualifications.
You may reorder, rephrase, merge and trim: open with a 2 to 3 line professional summary aimed at this role,
put the most relevant skills and experience first, reword bullet points to show results, and use the advert's
words wherever they truthfully describe the applicant. Keep every real employer, job title, date and qualification.
Plain text, no markdown: the applicant's name and contact details on the first lines, then sections with headings
in CAPITALS (PROFESSIONAL SUMMARY, KEY SKILLS, EXPERIENCE, EDUCATION, and any others the CV has),
bullet points starting with "- ". At most about 700 words. Reply with the CV only.`;

// The advert's text (its first 12,000 characters: enough for any job description), when its
// page can be read without a browser. Many job pages can't,
// and then the letter is written from the title and company alone.
export async function advertText(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; JobAlertBot/1.0)" }, redirect: "follow" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return "";
    const page = await r.text();
    return page.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 12000);
  } catch (e) {
    console.log(`[letter] couldn't read the advert: ${e}`);
    return "";
  }
}

// Returns the letter (kind "letter") or tailored CV (kind "cv"), or null if it couldn't be written.
export async function write(env, { cv, title, company, advert }, kind = "letter") {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY.trim() });
  const job = `Job title: ${title}\nCompany: ${company || "not stated"}\n\nAdvert:\n${advert || "(the advert's page couldn't be read; use the title and company)"}`;
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: kind === "cv" ? CV_SYSTEM : SYSTEM,
    messages: [{ role: "user", content: `<cv>\n${cv}\n</cv>\n\n<job>\n${job}\n</job>` }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return text || null;
}
