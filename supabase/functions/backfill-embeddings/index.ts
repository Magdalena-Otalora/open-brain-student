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
    const batchSize = body.batch_size ?? 5;

    // Always read from the top: rows that get embedded drop out of this
    // "is null" filter, so the next batch naturally picks up where we left off.
    const { data: thoughts, error } = await supabase
      .from("thoughts")
      .select("id, content")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .range(0, batchSize - 1);

    if (error) throw error;

    let embedded = 0;
    let failed = 0;

    for (const thought of thoughts ?? []) {
      try {
        const embResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-embedding`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ text: thought.content }),
        });
        const { embedding } = await embResponse.json();

        if (embedding) {
          await supabase.from("thoughts").update({ embedding }).eq("id", thought.id);
          embedded++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`backfill-embeddings error for thought ${thought.id}:`, err);
        failed++;
      }
    }

    const { count: remaining } = await supabase
      .from("thoughts")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    return new Response(
      JSON.stringify({
        processed: thoughts?.length ?? 0,
        embedded,
        failed,
        remaining: remaining ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("backfill-embeddings error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
