import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size ?? 3;
    const offset = body.offset ?? 0;

    const { data: thoughts, error } = await supabase
      .from("thoughts")
      .select("id, embedding")
      .not("embedding", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) throw error;

    let linked = 0;
    let alreadyDone = 0;

    for (const thought of thoughts ?? []) {
      // Skip if this thought already has links in either direction
      const { data: existing } = await supabase
        .from("thought_links")
        .select("id")
        .or(`source_thought_id.eq.${thought.id},target_thought_id.eq.${thought.id}`)
        .limit(1);

      if (existing && existing.length > 0) {
        alreadyDone++;
        continue;
      }

      const { data: neighbors, error: rpcError } = await supabase.rpc("find_links_for_thought", {
        source_id: thought.id,
        source_embedding: thought.embedding,
        match_threshold: 0.5,
        match_count: 5,
      });

      if (rpcError) {
        console.error(`backfill-links error for thought ${thought.id}:`, rpcError.message);
        continue;
      }

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
        linked++;
      }
    }

    const { count: totalWithEmbeddings } = await supabase
      .from("thoughts")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null);

    const offsetNext = offset + batchSize;
    const remaining = Math.max((totalWithEmbeddings ?? 0) - offsetNext, 0);

    return new Response(
      JSON.stringify({
        processed: thoughts?.length ?? 0,
        linked,
        already_done: alreadyDone,
        offset_next: offsetNext,
        remaining,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("backfill-links error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
