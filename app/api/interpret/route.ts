// AI interpretation endpoint for the /stats engine.
// POSTed by the client with { mode, payload, result } from a completed scipy
// analysis. Returns three labeled prose sections from Claude:
//   Interpretation, Assumptions, APA write-up.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5';

type Body = {
  mode: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are a senior biostatistician explaining results to a clinical researcher.
Be precise, practical, and brief. Translate effect sizes into plain language.
When the test's assumptions might be violated, say so and recommend an alternative.
Never invent numbers — only use what is provided.

Reply with EXACTLY three labeled sections in this format, with the headers verbatim and no markdown formatting beyond the headers:

## Interpretation
<2–4 sentences: what the result means for the study, including effect size in plain language>

## Assumptions
<2–3 sentences: were the test's assumptions plausibly met given the data shape? If not, recommend a specific alternative test.>

## APA write-up
<1–2 sentences in APA results format, ready to paste into a manuscript>

Keep the total under 220 words. Do not repeat the input numbers verbatim except those appropriate for an APA citation.`;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          'Server is missing ANTHROPIC_API_KEY. Add it under the Vercel project → Settings → Environment Variables and redeploy.',
      },
      { status: 503 }
    );
  }

  const userMessage = `Analysis: ${body.mode}\n\nInput summary:\n${JSON.stringify(
    body.payload,
    null,
    2
  )}\n\nResult from scipy.stats:\n${JSON.stringify(body.result, null, 2)}`;

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
  } catch (err) {
    const e = err as Error;
    return Response.json(
      { error: `Network error talking to Anthropic: ${e.message}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      {
        error: `Anthropic API ${upstream.status}: ${text.slice(0, 300)}`,
      },
      { status: 502 }
    );
  }

  type AnthropicResp = {
    content?: Array<{ type: string; text?: string }>;
  };
  const data = (await upstream.json()) as AnthropicResp;
  const text =
    (data.content || [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim() || '';

  return Response.json({ text, model: MODEL });
}
