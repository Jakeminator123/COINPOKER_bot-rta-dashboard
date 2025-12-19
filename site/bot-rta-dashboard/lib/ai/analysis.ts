import OpenAI from "openai";
import { redisKeys, redisTtl } from "@/lib/redis/schema";
import { getRedisClient } from "@/lib/redis/redis-client";

export type AIAnalysisInput = {
  deviceId: string;
  deviceName?: string | null;
  threatLevel?: number | null;
  detections?: Array<{ category: string; name: string; status?: string; details?: string }>;
  lastSeen?: number | null;
};

export type AIAnalysisResult = {
  deviceId: string;
  summary: string;
  risk: string;
  score: number;
  createdAt: number;
  tokens?: { prompt?: number; completion?: number; total?: number };
};

const aiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const DEFAULT_MODEL = process.env.ANALYSIS_MODEL || "gpt-4o-mini";
const MAX_HISTORY = 10;

function buildPrompt(input: AIAnalysisInput) {
  const threat = input.threatLevel ?? 0;
  const detections = (input.detections || []).slice(0, 5).map((d) => ({
    category: d.category,
    name: d.name,
    status: d.status,
  }));
  return `
You are a concise security analyst. Summarize player risk.
- Device: ${input.deviceId}
- Name: ${input.deviceName || "unknown"}
- Threat level: ${threat}
- Last seen: ${input.lastSeen ? new Date(input.lastSeen).toISOString() : "unknown"}
- Top detections (max 5): ${JSON.stringify(detections)}

Return JSON: {"summary": "...", "risk": "LOW|MEDIUM|HIGH", "score": 0-100}
Keep it brief (<= 60 words).`;
}

export async function analyzePlayerSummary(input: AIAnalysisInput): Promise<AIAnalysisResult> {
  const now = Date.now();

  // Fallback if no API key
  if (!aiClient) {
    return {
      deviceId: input.deviceId,
      summary: "AI analysis unavailable (missing OPENAI_API_KEY).",
      risk: "UNKNOWN",
      score: Math.max(0, Math.min(100, (input.threatLevel ?? 0) * 1)),
      createdAt: now,
    };
  }

  const prompt = buildPrompt(input);
  const response = await aiClient.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "";
  let parsed: Partial<AIAnalysisResult> = {};
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    parsed = { summary: text };
  }

  return {
    deviceId: input.deviceId,
    summary: parsed.summary || "No summary.",
    risk: (parsed.risk as string) || "UNKNOWN",
    score: typeof parsed.score === "number" ? parsed.score : Math.max(0, Math.min(100, (input.threatLevel ?? 0))),
    createdAt: now,
    tokens: {
      prompt: response.usage?.prompt_tokens,
      completion: response.usage?.completion_tokens,
      total: response.usage?.total_tokens,
    },
  };
}

export async function saveAIAnalysis(result: AIAnalysisResult) {
  const client = await getRedisClient();
  if (!client) return;

  const latestKey = redisKeys.aiAnalysisLatest(result.deviceId);
  const historyKey = redisKeys.aiAnalysisHistory(result.deviceId);

  await client.set(latestKey, JSON.stringify(result), {
    EX: redisTtl.aiAnalysisSeconds(),
  });

  await client.lPush(historyKey, JSON.stringify(result));
  await client.lTrim(historyKey, 0, MAX_HISTORY - 1);
  await client.expire(historyKey, redisTtl.aiAnalysisSeconds());
}

