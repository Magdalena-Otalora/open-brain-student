// open-brain-mcp
// This Edge Function is an MCP (Model Context Protocol) server.
// It lets any MCP-compatible AI (like Claude Desktop) search and add to your "brain" —
// the `thoughts` table in Supabase — without ever seeing your database credentials directly.

import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS headers so the function can be called from any origin (required for MCP clients)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Environment variables. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically by Supabase for every Edge Function — we don't set these ourselves.
// MCP_ACCESS_KEY is the custom secret we created to lock the server to our own devices.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The list of tools this MCP server offers. This is what gets returned
// when a client calls the "tools/list" method, and it's how Claude
// knows what it's allowed to ask for and what arguments each tool needs.
const TOOLS = [
  {
    name: "search_thoughts",
    description: "Search the brain for thoughts matching a text query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for inside thought content" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description: "List the most recently saved thoughts.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many thoughts to return (default 10)" },
      },
    },
  },
  {
    name: "add_thought",
    description: "Save a new thought to the brain.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The text content of the thought to save" },
      },
      required: ["content"],
    },
  },
];

// Wraps a result in the JSON-RPC 2.0 response shape MCP expects.
function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Runs the actual tool logic against the `thoughts` table and shapes
// the response the way MCP's "tools/call" method expects: a `content`
// array of text blocks.
async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "search_thoughts") {
    const query = String(args.query ?? "");
    const { data, error } = await supabase
      .from("thoughts")
      .select("id, content, created_at")
      .ilike("content", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }

  if (name === "list_recent") {
    const limit = Number(args.limit ?? 10);
    const { data, error } = await supabase
      .from("thoughts")
      .select("id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }

  if (name === "add_thought") {
    const content = String(args.content ?? "");
    const { data, error } = await supabase
      .from("thoughts")
      .insert({ content })
      .select("id, content, created_at")
      .single();

    if (error) throw new Error(error.message);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}

Deno.serve(async (req) => {
  // Browsers (and some MCP clients) send a preflight OPTIONS request before
  // the real POST. We just acknowledge it so the real request is allowed through.
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Every real request must prove it knows our MCP_ACCESS_KEY via the
  // Authorization header: "Bearer <key>". This is what keeps random
  // people on the internet from calling your brain's tools.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token !== MCP_ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify(jsonRpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { id, method, params } = body;

  try {
    // Notifications (method names starting with "notifications/") are one-way
    // messages the client sends after the handshake, like "notifications/initialized".
    // They don't get a JSON-RPC response, just a plain 202 acknowledgment.
    if (method?.startsWith("notifications/")) {
      return new Response(null, { status: 202, headers: corsHeaders });
    }

    // MCP handshake: the client asks what this server is.
    if (method === "initialize") {
      return new Response(
        JSON.stringify(
          jsonRpcResult(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "open-brain-mcp", version: "1.0.0" },
          }),
        ),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // The client asks what tools are available.
    if (method === "tools/list") {
      return new Response(JSON.stringify(jsonRpcResult(id, { tools: TOOLS })), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The client wants to actually run one of the tools.
    if (method === "tools/call") {
      const toolName = String(params?.name ?? "");
      const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};
      const result = await callTool(toolName, toolArgs);
      return new Response(JSON.stringify(jsonRpcResult(id, result)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(jsonRpcError(id, -32601, `Method not found: ${method}`)), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify(jsonRpcError(id, -32000, err instanceof Error ? err.message : "Server error")),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
