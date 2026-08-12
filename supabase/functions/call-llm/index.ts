// call-llm/index.ts
// To switch providers, change LLM_PROVIDER in Supabase secrets.
// Add the new provider's API key. No other code changes needed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const LLM_PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "anthropic";
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "claude-haiku-4-5-20251001";

Deno.serve(async (req) => {
  try {
    const { prompt, systemPrompt, model, maxTokens } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (LLM_PROVIDER !== "anthropic") {
      return new Response(
        JSON.stringify({ error: `Unsupported LLM_PROVIDER: ${LLM_PROVIDER}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model ?? LLM_MODEL,
        max_tokens: maxTokens ?? 1024,
        system: systemPrompt ?? undefined,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${errText}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    return new Response(JSON.stringify({ text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
