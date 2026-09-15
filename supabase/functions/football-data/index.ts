import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const API_BASE_URL = "https://v3.football.api-sports.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method not allowed" },
      405
    );
  }

  const apiKey = Deno.env.get("API_FOOTBALL_KEY");

  if (!apiKey) {
    return jsonResponse({
      ok: false,
      error: "API_FOOTBALL_KEY is not configured",
    });
  }

  const url = new URL(req.url);

  let action = url.searchParams.get("action") ?? "countries";
  let country = url.searchParams.get("country") ?? "Colombia";
  let season = url.searchParams.get("season") ?? "2026";
  let league = url.searchParams.get("league") ?? "";

  if (req.method === "POST") {
    try {
      const body = await req.json();

      if (body?.action) action = String(body.action);
      if (body?.country) country = String(body.country);
      if (body?.season) season = String(body.season);
      if (body?.league) league = String(body.league);
    } catch {
      // Mantener valores por defecto.
    }
  }

  let endpoint: string;

  if (action === "countries") {
    endpoint = "/countries";
  } else if (action === "leagues") {
    endpoint =
      `/leagues?country=${encodeURIComponent(country)}&season=${encodeURIComponent(season)}`;
  } else if (action === "teams") {
    if (!league) {
      return jsonResponse(
        {
          ok: false,
          error: "league is required for teams",
        },
        400
      );
    }

    endpoint =
      `/teams?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`;
  } else {
    return jsonResponse(
      {
        ok: false,
        error: "Unknown action",
        available_actions: [
          "countries",
          "leagues",
          "teams",
        ],
      },
      400
    );
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        "x-apisports-key": apiKey,
        Accept: "application/json",
      },
    });

    const data = await response.json();

    return jsonResponse({
      ok: response.ok,
      source: "api-football",
      action,
      endpoint,
      upstream_status: response.status,
      response: data,
    });
  } catch (error) {
    console.error("API-Football request failed", error);

    return jsonResponse({
      ok: false,
      source: "api-football",
      error: "Unable to reach API-Football",
    });
  }
});
