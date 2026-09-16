import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE_URL = "https://v3.football.api-sports.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("API_FOOTBALL_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey) return jsonResponse({ ok: false, error: "API_FOOTBALL_KEY is not configured" }, 500);
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ ok: false, error: "Supabase server configuration is incomplete" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url);
  let action = url.searchParams.get("action") ?? "countries";
  let country = url.searchParams.get("country") ?? "Colombia";
  let season = url.searchParams.get("season") ?? "2024";
  let league = url.searchParams.get("league") ?? "";

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.action) action = String(body.action);
      if (body?.country) country = String(body.country);
      if (body?.season) season = String(body.season);
      if (body?.league) league = String(body.league);
    } catch {}
  }

  let endpoint: string;
  if (action === "countries") endpoint = "/countries";
  else if (action === "leagues") endpoint = `/leagues?country=${encodeURIComponent(country)}&season=${encodeURIComponent(season)}`;
  else if (action === "teams" || action === "sync_teams") {
    if (!league) return jsonResponse({ ok: false, error: "league is required for teams" }, 400);
    endpoint = `/teams?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`;
  } else if (action === "sync_fixtures") {
    if (!league) return jsonResponse({ ok: false, error: "league is required for sync_fixtures" }, 400);
    endpoint = `/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`;
  } else return jsonResponse({ ok: false, error: "Unknown action", available_actions: ["countries", "leagues", "teams", "sync_teams", "sync_fixtures"] }, 400);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers: { "x-apisports-key": apiKey, Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) return jsonResponse({ ok: false, source: "api-football", action, endpoint, upstream_status: response.status, response: data });

    if (action === "sync_teams") {
      const { data: leagueRow, error: leagueError } = await admin.from("leagues").select("id, external_id, name").eq("external_id", String(Number(league))).maybeSingle();
      if (leagueError) return jsonResponse({ ok: false, error: "Could not find league in Supabase", details: leagueError.message }, 500);
      if (!leagueRow) return jsonResponse({ ok: false, error: "League is not yet stored in Supabase", external_id: String(Number(league)) }, 409);
      const items = Array.isArray(data?.response) ? data.response : [];
      const rows = items.filter((i: any) => i?.team?.id && i?.team?.name).map((i: any) => ({ league_id: leagueRow.id, name: String(i.team.name), short_name: i.team.code ? String(i.team.code) : null, country: i.team.country ? String(i.team.country) : null, external_id: String(i.team.id), is_active: true }));
      if (!rows.length) return jsonResponse({ ok: false, error: "API-Football returned no valid teams" }, 502);
      const { data: upserted, error } = await admin.from("teams").upsert(rows, { onConflict: "external_id" }).select("id, league_id, name, short_name, country, external_id, is_active");
      if (error) return jsonResponse({ ok: false, error: "Could not sync teams to Supabase", details: error.message }, 500);
      return jsonResponse({ ok: true, source: "api-football", action, league: leagueRow, season, fetched: rows.length, upserted: upserted?.length ?? rows.length, teams: upserted ?? rows });
    }

    if (action === "sync_fixtures") {
      const leagueExternalId = Number(league);
      if (!Number.isInteger(leagueExternalId)) return jsonResponse({ ok: false, error: "league must be a numeric API-Football league ID" }, 400);
      const { data: leagueRow, error: leagueError } = await admin.from("leagues").select("id, external_id, name").eq("external_id", String(leagueExternalId)).maybeSingle();
      if (leagueError) return jsonResponse({ ok: false, error: "Could not find league in Supabase", details: leagueError.message }, 500);
      if (!leagueRow) return jsonResponse({ ok: false, error: "League is not yet stored in Supabase", external_id: String(leagueExternalId) }, 409);

      const items = Array.isArray(data?.response) ? data.response : [];
      const teamIds = new Set<string>();
      for (const item of items) {
        if (item?.teams?.home?.id) teamIds.add(String(item.teams.home.id));
        if (item?.teams?.away?.id) teamIds.add(String(item.teams.away.id));
      }
      const { data: teamRows, error: teamError } = await admin.from("teams").select("id, external_id").in("external_id", [...teamIds]);
      if (teamError) return jsonResponse({ ok: false, error: "Could not load teams", details: teamError.message }, 500);
      const teamMap = new Map((teamRows ?? []).map((t: any) => [String(t.external_id), t.id]));
      const rows = items.filter((i: any) => i?.teams?.home?.id && i?.teams?.away?.id && i?.fixture?.date && i?.fixture?.id && teamMap.has(String(i.teams.home.id)) && teamMap.has(String(i.teams.away.id))).map((i: any) => ({ league_id: leagueRow.id, home_team_id: teamMap.get(String(i.teams.home.id)), away_team_id: teamMap.get(String(i.teams.away.id)), kickoff_at: new Date(i.fixture.date).toISOString(), status: String(i.fixture.status?.short ?? i.fixture.status?.long ?? "NS"), home_score: Number.isInteger(i.goals?.home) ? i.goals.home : null, away_score: Number.isInteger(i.goals?.away) ? i.goals.away : null, external_id: String(i.fixture.id), season: String(season), round: i.league?.round ? String(i.league.round) : null }));
      if (!rows.length) return jsonResponse({ ok: true, source: "api-football", action, league: leagueRow, season, fetched: items.length, mapped: 0, upserted: 0, matches: [], warning: "No fixtures could be mapped to teams already stored in Supabase" });
      const { data: upserted, error } = await admin.from("matches").upsert(rows, { onConflict: "external_id" }).select("id, league_id, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, external_id, season, round");
      if (error) return jsonResponse({ ok: false, error: "Could not sync fixtures to Supabase", details: error.message }, 500);
      return jsonResponse({ ok: true, source: "api-football", action, league: leagueRow, season, fetched: items.length, mapped: rows.length, upserted: upserted?.length ?? rows.length, matches: upserted ?? rows });
    }

    return jsonResponse({ ok: true, source: "api-football", action, endpoint, upstream_status: response.status, response: data });
  } catch (error) {
    console.error("API-Football request failed", error);
    return jsonResponse({ ok: false, source: "api-football", error: "Unable to reach API-Football" }, 502);
  }
});