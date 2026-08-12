const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!

// To switch embedding providers, change the model string. The vector dimension must stay 1536 or you need a new migration.
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text } = await req.json()

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ embedding: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // text-embedding-3-small caps input at ~8191 tokens (~4 chars/token).
    // Truncate long captures (full video transcripts, PDFs) so the request
    // doesn't get rejected outright — an embedding from the first ~30k chars
    // still captures the gist better than no embedding at all.
    const MAX_CHARS = 20000
    const truncatedText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncatedText,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      console.error('generate-embedding error:', await response.text())
      return new Response(JSON.stringify({ embedding: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const data = await response.json()
    const embedding = data?.data?.[0]?.embedding ?? null

    return new Response(JSON.stringify({ embedding }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    console.error('generate-embedding error:', err)
    return new Response(JSON.stringify({ embedding: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
