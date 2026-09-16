import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://v3.football.api-sports.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function apiFetch(path: string, key: string) {
  const response = await fetch(`${API}${path}`, {
    headers: { "x-apisports-key": key, Accept: "application/json" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`API-Football ${response.status}`);
  return data;
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json({ ok: false, error: "Method not allowed" }, 405);

  const key = Deno.env.get("API_FOOTBALL_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || !url || !service) return json({ ok: false, error: "Server configuration incomplete" }, 500);

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const params = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch {}
  }

  const action = String(body.action ?? params.searchParams.get("action") ?? "countries");
  const country = String(body.country ?? params.searchParams.get("country") ?? "Colombia");
  const season = String(body.season ?? params.searchParams.get("season") ?? "2026");
  const league = String(body.league ?? params.searchParams.get("league") ?? "");

  try {
    if (action === "countries") return json({ ok: true, action, response: await apiFetch("/countries", key) });

    if (action === "leagues") {
      return json({ ok: true, action, response: await apiFetch(`/leagues?country=${encodeURIComponent(country)}&season=${encodeURIComponent(season)}`, key) });
    }

    if (action === "teams" || action === "sync_teams") {
      if (!league) return json({ ok: false, error: "league is required" }, 400);
      const remote = await apiFetch(`/teams?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`, key);
      if (action === "teams") return json({ ok: true, action, response: remote });

      const { data: leagueRow, error: le } = await db.from("leagues")
        .select("id,external_id,name").eq("external_id", league).maybeSingle();
      if (le) throw le;
      if (!leagueRow) return json({ ok: false, error: "League is not stored in Supabase", external_id: league }, 409);

      let seasonRow = (await db.from("seasons").select("id,year").eq("year", season).maybeSingle()).data;
      if (!seasonRow) {
        const inserted = await db.from("seasons").insert({ year: season, is_current: season === "2026" }).select("id,year").single();
        if (inserted.error) throw inserted.error;
        seasonRow = inserted.data;
      }

      const rows = (remote.response ?? []).filter((x: any) => x?.team?.id && x?.team?.name)
        .map((x: any) => ({
          league_id: leagueRow.id, name: String(x.team.name),
          short_name: x.team.code ? String(x.team.code) : null,
          country: x.team.country ? String(x.team.country) : null,
          external_id: String(x.team.id), is_active: true,
        }));
      const up = await db.from("teams").upsert(rows, { onConflict: "external_id" }).select("id,league_id,name,short_name,country,external_id,is_active");
      if (up.error) throw up.error;

      const ls = await db.from("league_seasons").upsert(
        { league_id: leagueRow.id, season_id: seasonRow.id, external_id: `${league}-${season}` },
        { onConflict: "league_id,season_id" }
      ).select("id").single();
      if (ls.error) throw ls.error;

      const relations = (up.data ?? []).map((t: any) => ({ team_id: t.id, league_season_id: ls.data.id }));
      if (relations.length) {
        const tr = await db.from("team_league_seasons").upsert(relations, { onConflict: "team_id,league_season_id" });
        if (tr.error) throw tr.error;
      }

      return json({ ok: true, action, season, league: leagueRow, fetched: rows.length, upserted: up.data?.length ?? 0, teams: up.data ?? [] });
    }

    if (action === "sync_fixtures") {
      if (!league) return json({ ok: false, error: "league is required" }, 400);
      const remote = await apiFetch(`/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`, key);
      const { data: leagueRow, error: le } = await db.from("leagues").select("id,external_id,name").eq("external_id", league).maybeSingle();
      if (le) throw le;
      if (!leagueRow) return json({ ok: false, error: "League is not stored in Supabase" }, 409);

      let seasonRow = (await db.from("seasons").select("id,year").eq("year", season).maybeSingle()).data;
      if (!seasonRow) {
        const inserted = await db.from("seasons").insert({ year: season, is_current: season === "2026" }).select("id,year").single();
        if (inserted.error) throw inserted.error;
        seasonRow = inserted.data;
      }

      const ids = new Set<string>();
      for (const x of remote.response ?? []) {
        if (x?.teams?.home?.id) ids.add(String(x.teams.home.id));
        if (x?.teams?.away?.id) ids.add(String(x.teams.away.id));
      }
      const tr = await db.from("teams").select("id,external_id").in("external_id", [...ids]);
      if (tr.error) throw tr.error;
      const map = new Map((tr.data ?? []).map((t: any) => [String(t.external_id), t.id]));

      const rows = (remote.response ?? []).filter((x: any) =>
        x?.fixture?.id && x?.fixture?.date && map.has(String(x?.teams?.home?.id)) && map.has(String(x?.teams?.away?.id))
      ).map((x: any) => ({
        league_id: leagueRow.id,
        home_team_id: map.get(String(x.teams.home.id)),
        away_team_id: map.get(String(x.teams.away.id)),
        kickoff_at: new Date(x.fixture.date).toISOString(),
        status: String(x.fixture.status?.short ?? "NS"),
        home_score: Number.isInteger(x.goals?.home) ? x.goals.home : null,
        away_score: Number.isInteger(x.goals?.away) ? x.goals.away : null,
        external_id: String(x.fixture.id), season, season_id: seasonRow.id,
        round: x.league?.round ? String(x.league.round) : null,
      }));

      if (!rows.length) return json({ ok: true, action, season, fetched: (remote.response ?? []).length, mapped: 0, upserted: 0, matches: [], warning: "No fixtures mapped. Sync teams first." });

      const up = await db.from("matches").upsert(rows, { onConflict: "external_id" }).select("id,league_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score,external_id,season,season_id,round");
      if (up.error) throw up.error;
      return json({ ok: true, action, season, fetched: (remote.response ?? []).length, mapped: rows.length, upserted: up.data?.length ?? 0, matches: up.data ?? [] });
    }

    if (action === "sync_statistics") {
      const fixtureIds = Array.isArray(body.fixture_ids)
        ? body.fixture_ids.map(String).filter(Boolean)
        : [];
      if (!fixtureIds.length) return json({ ok: false, error: "fixture_ids is required" }, 400);

      let saved = 0, fetched = 0, errors: string[] = [];
      for (const batch of chunks(fixtureIds, 20)) {
        try {
          const remote = await apiFetch(`/fixtures?ids=${batch.join("-")}`, key);
          fetched += (remote.response ?? []).length;
          for (const fixture of remote.response ?? []) {
            const externalId = String(fixture?.fixture?.id ?? "");
            const match = (await db.from("matches").select("id").eq("external_id", externalId).maybeSingle()).data;
            if (!match) continue;

            const stats = Array.isArray(fixture?.statistics) ? fixture.statistics : [];
            const rows = stats.map((entry: any) => {
              const s = entry?.statistics ?? [];
              const get = (type: string) => s.find((x: any) => x.type === type)?.value;
              const pct = (v: any) => typeof v === "string" ? Number(v.replace("%", "")) : (typeof v === "number" ? v : null);
              const n = (v: any) => typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : null);
              const teamExternal = entry?.team?.id;
              return {
                match_id: match.id,
                team_id: null,
                external_team_id: teamExternal ? String(teamExternal) : null,
                shots_total: n(get("Total Shots")),
                shots_on_target: n(get("Shots on Goal")),
                shots_off_target: n(get("Shots off Goal")),
                shots_blocked: n(get("Blocked Shots")),
                possession_pct: pct(get("Ball Possession")),
                corners: n(get("Corner Kicks")),
                fouls: n(get("Fouls")),
                offsides: n(get("Offsides")),
                yellow_cards: n(get("Yellow Cards")),
                red_cards: n(get("Red Cards")),
                goalkeeper_saves: n(get("Goalkeeper Saves")),
                passes_total: n(get("Total passes")),
                passes_accurate: n(get("Passes accurate")),
                pass_accuracy_pct: pct(get("Passes %")),
                source: "api-football",
              };
            });

            for (const row of rows) {
              const team = row.external_team_id
                ? (await db.from("teams").select("id").eq("external_id", row.external_team_id).maybeSingle()).data
                : null;
              if (!team) continue;
              const clean = { ...row, team_id: team.id };
              delete clean.external_team_id;
              const up = await db.from("match_statistics").upsert(clean, { onConflict: "match_id,team_id" });
              if (up.error) throw up.error;
              saved++;
            }
          }
        } catch (e) { errors.push(e instanceof Error ? e.message : "batch error"); }
      }
      return json({ ok: true, action, requested: fixtureIds.length, fetched, saved, errors });
    }

    return json({ ok: false, error: "Unknown action", available_actions: ["countries","leagues","teams","sync_teams","sync_fixtures","sync_statistics"] }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Operation failed" }, 502);
  }
});