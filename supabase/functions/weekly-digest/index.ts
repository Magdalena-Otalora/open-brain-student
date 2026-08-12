// weekly-digest/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (_req) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: thoughts, error } = await supabase
      .from("thoughts")
      .select("*")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!thoughts || thoughts.length < 5) {
      console.log(`Not enough content for a digest: only ${thoughts?.length ?? 0} thoughts this week.`);
      return new Response(JSON.stringify({ skipped: true, count: thoughts?.length ?? 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const byCategory: Record<string, string[]> = {};
    for (const t of thoughts) {
      const cat = t.category ?? "uncategorized";
      byCategory[cat] = byCategory[cat] ?? [];
      byCategory[cat].push(t.content);
    }

    const grouped = Object.entries(byCategory)
      .map(([cat, items]) => `${cat.toUpperCase()}:\n${items.map((i) => `- ${i}`).join("\n")}`)
      .join("\n\n");

    const prompt = `Here are someone's saved thoughts from the past week, grouped by category:

${grouped}

Write a short weekly digest with:
1. A summary of what they were learning, organized by theme
2. Key themes across the week
3. One open question they seem to be exploring

Keep it warm, personal, and under 300 words.`;

    const llmResponse = await fetch(`${SUPABASE_URL}/functions/v1/call-llm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ prompt, maxTokens: 600 }),
    });

    const { text: digestText } = await llmResponse.json();

    await supabase.from("thoughts").insert({
      content: digestText,
      category: "digest",
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
