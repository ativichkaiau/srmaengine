// AI interpretation endpoint for the /stats engine.
// POSTed by the client with { mode, payload, result } from a completed scipy
// analysis. Returns three labeled prose sections from OpenAI ChatGPT:
//   Interpretation, Assumptions, APA write-up.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

type Body = {
  mode: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are the senior statistical reviewer for VESTRIPPN3.0, explaining results to a clinical researcher.
Be precise, skeptical, practical, and concise. Lead with the estimated effect and its uncertainty; treat the p-value as supporting information, not the conclusion.
Translate effect sizes into plain language and distinguish statistical significance from clinical or practical importance.
Use the supplied assumption diagnostics. A non-significant diagnostic does not prove an assumption, and a significant diagnostic should trigger a specific sensitivity analysis or alternative.
Do not infer randomization, independence, causality, clinical importance, or adequate power unless the supplied information supports it.
For correlations and regressions, explicitly avoid causal language. For multiple-group ANOVA, note that a significant omnibus test does not identify which groups differ.
Never invent values or claim a diagnostic was performed when it is absent.

Reply with EXACTLY three labeled sections in this format, with the headers verbatim and no markdown formatting beyond the headers:

## Interpretation
<3–5 sentences: answer the study question using the point estimate, 95% confidence interval when available, effect-size magnitude, p-value, and sample size. State what is not established.>

## Assumptions
<2–4 sentences: summarize only the diagnostics provided, explain their limits, and recommend a specific plot, sensitivity analysis, robust method, or alternative test when warranted.>

## APA write-up
<1–2 sentences in APA results format, including the estimate/effect size and confidence interval where available. Do not include significance stars.>

Keep the total under 300 words. Use "suggests" or "is consistent with" when the design cannot support stronger claims.`;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || !body.mode || !body.result) {
    return Response.json(
      { error: 'Missing mode or result in body.' },
      { status: 400 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          'Server is missing OPENAI_API_KEY. Add it under the Vercel project → Settings → Environment Variables and redeploy.',
      },
      { status: 503 }
    );
  }

  const userMessage = `Analysis mode: ${body.mode}

Computed result and diagnostics (authoritative):
${JSON.stringify(body.result, null, 2)}

Raw input supplied by the researcher (context only):
${JSON.stringify(body.payload, null, 2)}`;

  let upstream: Response;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    });
  } catch (err) {
    const e = err as Error;
    return Response.json(
      { error: `Network error talking to OpenAI: ${e.message}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      {
        error: `OpenAI API ${upstream.status}: ${text.slice(0, 300)}`,
      },
      { status: 502 }
    );
  }

  type OpenAIResp = {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const data = (await upstream.json()) as OpenAIResp;
  const text = (data.choices?.[0]?.message?.content || '').trim();

  return Response.json({ text, model: MODEL });
}
