// Ports the Gemini-then-OpenAI-fallback pattern the old Supabase edge
// functions used for AI grading and focus-report generation.

const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const OPENAI_MODEL = 'gpt-4o-mini';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );

  if (!res.ok) {
    const err = new Error(`Gemini request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return text;
}

async function callOpenAi(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = new Error(`OpenAI request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned no content');
  return text;
}

/** Cleans up common LLM JSON-formatting mistakes (markdown fences, stray text) before JSON.parse. */
function extractJson(text) {
  let cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

/** Tries Gemini first, falls back to OpenAI on a retryable failure or if Gemini isn't configured. */
async function callAiWithFallback(prompt) {
  if (process.env.GEMINI_API_KEY) {
    try {
      const text = await callGemini(prompt);
      return extractJson(text);
    } catch (err) {
      const retryable = !err.status || RETRYABLE_STATUS.has(err.status);
      if (!retryable || !process.env.OPENAI_API_KEY) throw err;
    }
  }
  const text = await callOpenAi(prompt);
  return extractJson(text);
}

module.exports = { callAiWithFallback };
