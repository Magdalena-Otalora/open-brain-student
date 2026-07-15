import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const message = body?.message

    if (!message || !message.text) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const chatId = message.chat.id
    const text: string = message.text.trim()

    if (text.startsWith('/search') || text.startsWith('?')) {
      const query = text.replace(/^\/search/, '').replace(/^\?/, '').trim()

      if (!query) {
        await sendTelegramMessage(chatId, 'Send /search followed by a keyword, e.g. /search coffee')
      } else {
        const { data, error } = await supabase
          .from('thoughts')
          .select('content, created_at')
          .ilike('content', `%${query}%`)
          .order('created_at', { ascending: false })
          .limit(5)

        if (error) throw error

        if (!data || data.length === 0) {
          await sendTelegramMessage(chatId, `No results found for "${query}"`)
        } else {
          const results = data.map((t, i) => `${i + 1}. ${t.content.slice(0, 200)}`).join('\n\n')
          await sendTelegramMessage(chatId, `Found ${data.length} result(s) for "${query}":\n\n${results}`)
        }
      }
    } else if (text.startsWith('/recent')) {
      const { data, error } = await supabase
        .from('thoughts')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error

      if (!data || data.length === 0) {
        await sendTelegramMessage(chatId, 'No thoughts saved yet.')
      } else {
        const results = data.map((t, i) => `${i + 1}. ${t.content.slice(0, 200)}`).join('\n\n')
        await sendTelegramMessage(chatId, `Your last ${data.length} thoughts:\n\n${results}`)
      }
    } else {
      const { error } = await supabase
        .from('thoughts')
        .insert({ content: text })

      if (error) throw error

      await sendTelegramMessage(chatId, '✅ Saved to your brain')
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    console.error('telegram-bot error:', err)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
