// yoga-coach — Adaptive AI yoga coach (Phase 1 MVP).
// Recommends 1-3 existing classes from the real course catalog based on the
// user's profile, recent practice history, and today's check-in.
// Fallback chain: Gemini (structured output) -> Groq (JSON mode) -> deterministic.
// All AI runs are traced to Langfuse. Secrets never leave the server.
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { Langfuse } from "npm:langfuse@3.39.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const AI_TIMEOUT_MS = 8_000;
const MAX_CATALOG_ITEMS = 120;

const SYSTEM_PROMPT = `You are an adaptive, supportive Yoga Coach. Your job is to recommend 1 to 3 existing yoga classes from the provided catalog based on the user's profile, injury history, recent practice logs, and today's check-in (energy, soreness, focus).
Rules:
1. STRICT CATALOG ONLY: You may ONLY select course_id values present in the provided catalog list. Never invent or alter IDs.
2. SAFETY FIRST: Respect all reported injuries, limitations, and soreness. If energy is low or soreness is high, prioritize restorative, gentle, or shorter classes and include a brief modification tip.
3. PROGRESSIVE ADAPTATION: Reference their experience level and recent session difficulty feedback (e.g., if the last session felt "too hard," scale back intensity today).
4. CONCISE TONE: Keep coach_message warm, grounded, and under 40 words.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

interface CatalogItem {
  course_id: string;
  title: string;
  minutes: number | null;
  intensity: string | null;
  theme: string | null;
}

interface CheckIn {
  energy?: string;
  soreness?: string;
  focus?: string;
}

interface CoachRequest {
  checkIn?: CheckIn;
  coachProfile?: {
    experienceLevel?: string;
    goals?: string;
    sessionMinutes?: number;
    daysPerWeek?: number;
    injuries?: string;
  };
}

async function fetchCatalog(supabase: ReturnType<typeof createClient>): Promise<CatalogItem[]> {
  const { data, error } = await supabase
    .from("course_sequence_analysis")
    .select(`
      course_id,
      course_title,
      total_duration_minutes,
      effective_intensity_band,
      effective_primary_theme,
      courses!inner(title, is_system)
    `)
    .eq("courses.is_system", true)
    .order("course_id", { ascending: true })
    .limit(MAX_CATALOG_ITEMS);
  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => ({
    course_id: String(row.course_id),
    title: String(row.course_title ?? row["courses"]?.title ?? ""),
    minutes: row.total_duration_minutes == null ? null : Number(row.total_duration_minutes),
    intensity: row.effective_intensity_band ? String(row.effective_intensity_band) : null,
    theme: row.effective_primary_theme ? String(row.effective_primary_theme) : null,
  }));
}

async function fetchRecentHistory(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from("sequence_completions")
    .select("title, rating, difficulty_feedback, completed_at, duration_seconds")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return (data || []).map((row: Record<string, unknown>) => ({
    title: row.title,
    rating: row.rating,
    difficulty_feedback: row.difficulty_feedback,
    completed_at: row.completed_at,
    duration_seconds: row.duration_seconds,
  }));
}

async function fetchRecentRatings(supabase: ReturnType<typeof createClient>, userId: string) {
  // Kept separate in case ratings live on a different table in the future.
  return fetchRecentHistory(supabase, userId);
}

function buildUserPrompt(
  checkIn: CheckIn,
  coachProfile: CoachRequest["coachProfile"],
  catalog: CatalogItem[],
  history: Awaited<ReturnType<typeof fetchRecentHistory>>,
): string {
  const catalogList = catalog
    .map((c) => `- id=${c.course_id} | ${c.title} | ${c.minutes ?? "?"} min | intensity: ${c.intensity ?? "?"} | focus: ${c.theme ?? "?"}`)
    .join("\n");
  const historyLines = history.length
    ? history.map((h) => `- ${h.title}${h.difficulty_feedback ? ` (felt: ${h.difficulty_feedback})` : ""}${h.rating ? ` [rating ${h.rating}]` : ""}`).join("\n")
    : "- (no sessions recorded yet)";
  return `USER PROFILE
Experience level: ${coachProfile?.experienceLevel || "unknown"}
Main goal: ${coachProfile?.goals || "not stated"}
Preferred session length: ${coachProfile?.sessionMinutes ? `${coachProfile.sessionMinutes} minutes` : "unspecified"}
Days per week: ${coachProfile?.daysPerWeek || "unspecified"}
Injuries / limitations: ${coachProfile?.injuries || "none reported"}

RECENT PRACTICE (newest first)
${historyLines}

TODAY'S CHECK-IN
Energy: ${checkIn?.energy || "not reported"}
Soreness: ${checkIn?.soreness || "none reported"}
Focus: ${checkIn?.focus || "not reported"}

AVAILABLE CATALOG (${catalog.length} classes — recommend ONLY from these ids)
${catalogList}`;
}

function responseSchema(validIds: string[]) {
  return {
    type: "object",
    properties: {
      coach_message: { type: "string" },
      recommended_sessions: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            course_id: { type: "string", enum: validIds },
            reason: { type: "string" },
            modification_tip: { type: "string" },
          },
          required: ["course_id", "reason"],
        },
      },
    },
    required: ["coach_message", "recommended_sessions"],
  };
}

async function callGemini(prompt: string, validIds: string[]) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema(validIds),
          temperature: 0.6,
        },
      }),
    },
    AI_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return JSON.parse(text);
}

async function callGroq(prompt: string, validIds: string[]) {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");
  const res = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    },
    AI_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no content");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.recommended_sessions) || !parsed.recommended_sessions.length) {
    throw new Error("Groq response missing recommended_sessions");
  }
  return parsed;
}

function pickDeterministic(catalog: CatalogItem[], checkIn: CheckIn): { coach_message: string; recommended_sessions: Array<Record<string, unknown>> } {
  const lowEnergy = /low|exhaust|tired/i.test(checkIn?.energy || "");
  const sore = checkIn?.soreness && !/^none$/i.test(checkIn.soreness);
  const wanted = (lowEnergy || sore) ? "gentle" : "moderate";
  const byFit = [...catalog].sort((a, b) => {
    const aFit = (a.intensity?.toLowerCase().includes(wanted) ? 0 : 1) + (a.minutes && a.minutes > 60 ? 1 : 0);
    const bFit = (b.intensity?.toLowerCase().includes(wanted) ? 0 : 1) + (b.minutes && b.minutes > 60 ? 1 : 0);
    return aFit - bFit;
  });
  const picks = byFit.slice(0, 3).filter(Boolean);
  return {
    coach_message: lowEnergy || sore
      ? "Thanks for checking in. Today calls for something gentler — these sessions favor ease and recovery."
      : "Thanks for checking in. Here are balanced sessions to meet you where you are today.",
    recommended_sessions: picks.map((c) => ({
      course_id: c.course_id,
      reason: `${c.title} fits a ${wanted} practice today${c.theme ? ` with a ${c.theme.toLowerCase()} focus` : ""}.`,
      modification_tip: sore ? "Move within a pain-free range and keep props nearby." : undefined,
    })),
  };
}

function validateRecommendations(result: { coach_message?: string; recommended_sessions?: Array<{ course_id?: string; reason?: string; modification_tip?: string }> }, validIds: Set<string>, catalog: CatalogItem[], checkIn: CheckIn) {
  const sessions = (result?.recommended_sessions || [])
    .filter((s) => s && validIds.has(String(s.course_id)))
    .slice(0, 3)
    .map((s) => {
      const item = catalog.find((c) => c.course_id === String(s.course_id));
      return {
        course_id: String(s.course_id),
        title: item?.title || "",
        reason: String(s.reason || ""),
        modification_tip: s.modification_tip ? String(s.modification_tip) : null,
      };
    });
  if (!sessions.length) throw new Error("No valid course ids in AI response");
  return {
    coach_message: String(result?.coach_message || "Here is today's practice suggestion.").slice(0, 500),
    recommended_sessions: sessions,
  };
}

async function scoreToLangfuse(traceId: string, userId: string, value: number, recommendationId: string | null) {
  const publicKey = Deno.env.get("LANGFUSE_PUBLIC_KEY");
  const secretKey = Deno.env.get("LANGFUSE_SECRET_KEY");
  const baseUrl = Deno.env.get("LANGFUSE_BASE_URL") || "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) return;
  try {
    const langfuse = new Langfuse({ publicKey, secretKey, baseUrl, flushAt: 1, flushInterval: 1 });
    langfuse.score({
      traceId,
      name: "user-feedback",
      value,
      userId,
      comment: recommendationId ? `recommendation:${recommendationId}` : undefined,
    });
    await langfuse.flushAsync();
  } catch (err) {
    console.warn("[yoga-coach] Langfuse score failed:", err);
  }
}

async function traceToLangfuse(params: {
  userId: string;
  checkIn: CheckIn;
  prompt: string;
  model: string;
  latencyMs: number;
  result: unknown;
  error?: string;
}) {
  const publicKey = Deno.env.get("LANGFUSE_PUBLIC_KEY");
  const secretKey = Deno.env.get("LANGFUSE_SECRET_KEY");
  const baseUrl = Deno.env.get("LANGFUSE_BASE_URL") || "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) return null;
  try {
    const langfuse = new Langfuse({
      publicKey,
      secretKey,
      baseUrl,
      flushAt: 1,
      flushInterval: 1,
    });
    const trace = langfuse.trace({
      name: "yoga-coach-recommendation",
      userId: params.userId,
      metadata: {
        checkIn: params.checkIn,
        model: params.model,
        latencyMs: params.latencyMs,
        error: params.error ?? null,
      },
    });
    trace.generation({
      name: `recommendation:${params.model}`,
      model: params.model,
      input: params.prompt,
      output: params.result ? JSON.stringify(params.result).slice(0, 4000) : String(params.error),
    });
    await langfuse.flushAsync();
    return trace.id;
  } catch (err) {
    console.warn("[yoga-coach] Langfuse trace failed:", err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    let body: CoachRequest & { feedback?: { traceId?: string; value?: number; recommendationId?: string | null } } = {};
    try { body = await req.json(); } catch { body = {}; }

    if (body.feedback?.traceId) {
      const rawValue = Number(body.feedback.value);
      const value = rawValue >= 0 ? 1 : -1;
      await scoreToLangfuse(body.feedback.traceId, userId, value, body.feedback.recommendationId ?? null);
      return json({ ok: true });
    }

    const checkIn = body.checkIn || {};
    const coachProfile = body.coachProfile || {};

    const [catalog, history] = await Promise.all([
      fetchCatalog(supabase),
      fetchRecentHistory(supabase, userId),
    ]);
    if (!catalog.length) return json({ error: "Course catalog is unavailable" }, 503);

    const prompt = buildUserPrompt(checkIn, coachProfile, catalog, history);
    const validIds = new Set(catalog.map((c) => c.course_id));
    const startedAt = Date.now();

    let model = "";
    let result: { coach_message: string; recommended_sessions: Array<Record<string, unknown>> } | null = null;
    let lastError: string | null = null;

    try {
      result = validateRecommendations(await callGemini(prompt, [...validIds]), validIds, catalog, checkIn);
      model = "gemini";
    } catch (err) {
      lastError = String(err?.message || err);
      console.warn("[yoga-coach] Gemini failed:", lastError);
    }

    if (!result) {
      try {
        result = validateRecommendations(await callGroq(prompt, validIds), validIds, catalog, checkIn);
        model = "groq";
      } catch (err) {
        lastError = String(err?.message || err);
        console.warn("[yoga-coach] Groq failed:", lastError);
      }
    }

    if (!result) {
      result = pickDeterministic(catalog, checkIn);
      model = "fallback";
    }

    const latencyMs = Date.now() - startedAt;
    const traceId = await traceToLangfuse({
      userId,
      checkIn,
      prompt,
      model,
      latencyMs,
      result,
      error: model === "fallback" ? lastError : undefined,
    });

    const { data: saved, error: saveError } = await supabase
      .from("coach_recommendations")
      .insert({
        user_id: userId,
        trace_id: traceId,
        model_used: model,
        coach_message: result.coach_message,
        recommended_sessions: result.recommended_sessions,
        check_in: checkIn,
      })
      .select("id")
      .single();
    if (saveError) console.warn("[yoga-coach] Could not save recommendation:", saveError.message);

    return json({
      id: saved?.id ?? null,
      traceId,
      model_used: model,
      coach_message: result.coach_message,
      recommended_sessions: result.recommended_sessions,
    });
  } catch (err) {
    console.error("[yoga-coach] Unhandled error:", err);
    return json({ error: err?.message || "Coach is unavailable" }, 500);
  }
});
