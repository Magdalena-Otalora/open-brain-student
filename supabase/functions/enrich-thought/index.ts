// enrich-thought/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const thought = payload.record;

    // Skip if content is too short to be worth enriching
    if (!thought || !thought.content || thought.content.length < 20) {
      return new Response("OK", { status: 200 });
    }

    const prompt = `Analyze this note and respond with ONLY valid JSON, no other text.
Note: "${thought.content}"

Respond in this exact JSON format:
{
  "tags": ["tag1", "tag2", "tag3"],
  "category": "one of: idea, learning, question, reference, plan, reflection",
  "summary": "one sentence summary"
}`;

    const llmResponse = await fetch(`${SUPABASE_URL}/functions/v1/call-llm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ prompt }),
    });

    const { text } = await llmResponse.json();
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const enrichment = JSON.parse(cleaned);

    await supabase
      .from("thoughts")
      .update({
        tags: enrichment.tags,
        category: enrichment.category,
        summary: enrichment.summary,
        enriched_at: new Date().toISOString(),
      })
      .eq("id", thought.id);

    // Generate embedding
    const embResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ text: thought.content }),
    });
    const { embedding } = await embResponse.json();

    // Save embedding if we got one
    if (embedding) {
      await supabase
        .from("thoughts")
        .update({ embedding })
        .eq("id", thought.id);
    }

    // Auto-link: find and save neighbors
    if (embedding) {
      const { data: neighbors } = await supabase.rpc("find_links_for_thought", {
        source_id: thought.id,
        source_embedding: embedding,
        match_threshold: 0.5,
        match_count: 5,
      });

      if (neighbors && neighbors.length > 0) {
        const links = neighbors.map((n: { target_id: string; similarity: number }) => ({
          source_thought_id: thought.id,
          target_thought_id: n.target_id,
          similarity_score: n.similarity,
          link_type: "semantic",
        }));

        await supabase
          .from("thought_links")
          .upsert(links, { onConflict: "source_thought_id,target_thought_id", ignoreDuplicates: true });
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    // Webhook functions should not fail even if something goes wrong
    return new Response("OK", { status: 200 });
  }
});
