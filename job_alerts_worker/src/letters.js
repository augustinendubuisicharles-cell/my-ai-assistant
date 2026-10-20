// AI cover letters, tailored CVs and interview prep for paying members: their pasted CV + the job advert ->
// a letter, their CV rewritten for that job, or likely interview questions with answers, to copy or download. Needs ANTHROPIC_API_KEY (GitHub secret JOB_ALERTS_ANTHROPIC_KEY).
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
export const PER_DAY = 10;      // of each kind (letters, CVs, preps) per member per day: keeps costs predictable
export const MAX_CV = 15000;    // characters of pasted CV we keep

export const enabled = (env) => Boolean((env.ANTHROPIC_API_KEY || "").trim());

const SYSTEM = `You write cover letters for job seekers, most of them in Nigeria applying to remote jobs abroad.
Write one letter for the job below, using only facts from the applicant's CV: never invent experience,
employers, numbers or qualifications. 200 to 300 words, warm and confident, plain English, no clichés.
Open with "Dear Hiring Manager," and end with the applicant's name if the CV gives it.
Connect two or three specific things from the CV to what the job needs. Reply with the letter only.`;

const CV_SYSTEM = `You tailor CVs for job seekers, most of them in Nigeria applying to remote jobs abroad.
Rewrite the applicant's CV for this one job so a recruiter, and their screening software, sees at a glance
that this person fits THIS advert. A CV that would suit any job is a failure.

First, privately read the advert and pick out what it asks for most: the exact job title, the 5 to 8 most important
skills, tools and duties, and the words it uses for them. Then write the CV so that:
- PROFESSIONAL SUMMARY (2 to 3 lines) names this job title and the company if known, and leads with the applicant's
  strongest proof for this advert's top needs.
- KEY SKILLS lists the advert's own wording first, for every skill the CV truly shows, then other relevant skills.
- In EXPERIENCE, each role's bullets are reordered so the ones closest to this job come first, reworded in the
  advert's language and showing results; bullets that don't help this application are shortened or dropped.
- Sections are ordered for this job (for example, a relevant certificate moves up).
Use only facts from the CV: never invent experience, employers, dates, numbers, tools or qualifications, and never
add a skill the CV doesn't show just because the advert wants it, or a reason or quality to a fact ("through a
  personable approach") that the CV doesn't state. Keep every real employer, job title, date and qualification.
Plain text, no markdown: the applicant's name and contact details on the first lines, then sections with headings
in CAPITALS (PROFESSIONAL SUMMARY, KEY SKILLS, EXPERIENCE, EDUCATION, and any others the CV has),
bullet points starting with "- ". At most about 700 words. Reply with the CV only.`;

const PREP_SYSTEM = `You help job seekers prepare for interviews, most of them in Nigeria interviewing for remote jobs abroad.
From the job advert and the applicant's CV, write an interview prep sheet for this job. Plain text, no markdown:
WHAT THEY'LL LOOK FOR: 3 short lines on what this employer most wants, read from the advert.
LIKELY QUESTIONS: 8 questions this interviewer is likely to ask (a mix of role-specific, behavioural and
"why us / why remote"). After each question, "Your answer: " and a suggested answer of 2 to 4 sentences
in the applicant's own voice, built only on facts from their CV (use the STAR shape for behavioural ones).
Never invent experience, employers, numbers or qualifications: where the CV has nothing to draw on, say
what to stress instead and mark it "(prepare this one)".
QUESTIONS TO ASK THEM: 3 good questions for the end of the interview.
ON THE DAY: 4 short practical tips for a video interview from Nigeria (internet backup, time zones, quiet room, follow-up email).
Number the questions. At most about 1,000 words. Reply with the sheet only.`;

const SYSTEMS = { letter: SYSTEM, cv: CV_SYSTEM, prep: PREP_SYSTEM };

// The advert's text (its first 12,000 characters: enough for any job description), when its
// page can be read without a browser. Many job pages can't (Himalayas and Jooble's sites answer
// "Just a moment..."), so advertFor() starts from the copy saved when the job was emailed.
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

// The advert for a letter or CV: the saved copy, plus the live page when the saved one is short
// (some feeds, like Jobspresso's, only give the first few lines).
export async function advertFor(url, saved = "") {
  saved = saved.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (saved.length >= 1500) return saved.slice(0, 12000);
  const page = await advertText(url);
  return [saved, page].filter(Boolean).join("\n\nThe advert's page:\n").slice(0, 12000);
}

// Returns the letter (kind "letter"), tailored CV (kind "cv") or interview prep (kind "prep"), or null if it couldn't be written.
export async function write(env, { cv, title, company, advert }, kind = "letter") {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY.trim() });
  const job = `Job title: ${title}\nCompany: ${company || "not stated"}\n\nAdvert:\n${advert || "(the advert's page couldn't be read; use the title and company)"}`;
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: kind === "cv" ? "medium" : "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEMS[kind] || SYSTEM,
    messages: [{ role: "user", content: `<cv>\n${cv}\n</cv>\n\n<job>\n${job}\n</job>` }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return text || null;
}
