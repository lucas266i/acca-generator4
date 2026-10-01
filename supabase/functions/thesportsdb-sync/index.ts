import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://www.thesportsdb.com/api/v1/json";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function tsdb(path: string, key: string) {
  const r = await fetch(`${API}/${encodeURIComponent(key)}/${path}`);
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`TheSportsDB returned non-JSON (${r.status})`); }
  if (!r.ok) throw new Error(`TheSportsDB HTTP ${r.status}`);
  return data;
}

function isoDate(offset: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!["GET", "POST"].includes(req.method)) return out({ ok: false, error: "Method not allowed" }, 405);

  const key = Deno.env.get("THESPORTSDB_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || !url || !service) return out({ ok: false, error: "Missing THESPORTSDB_API_KEY / Supabase server configuration" }, 500);

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: any = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}
  const action = String(body.action ?? new URL(req.url).searchParams.get("action") ?? "sync_all");
  if (action !== "sync_all") return out({ ok: false, error: "Unknown action", available_actions: ["sync_all"] }, 400);

  const errors: string[] = [];
  let eventsFetched = 0, matchesSaved = 0, teamsSaved = 0, leaguesSaved = 0;
  const leagueCache = new Map<string, string>();
  const teamCache = new Map<string, string>();

  try {
    for (let day = 0; day < 8; day++) {
      const date = isoDate(day);
      try {
        const data = await tsdb(`eventsday.php?d=${date}&s=Soccer`, key);
        const events = Array.isArray(data?.events) ? data.events : [];
        eventsFetched += events.length;

        for (const e of events) {
          const eventId = e?.idEvent ? String(e.idEvent) : "";
          const homeName = String(e?.strHomeTeam ?? "").trim();
          const awayName = String(e?.strAwayTeam ?? "").trim();
          const leagueName = String(e?.strLeague ?? "").trim();
          if (!eventId || !homeName || !awayName || !leagueName) continue;

          const leagueExt = `tsdb:${String(e.idLeague ?? leagueName).trim()}`;
          let leagueId = leagueCache.get(leagueExt);
          if (!leagueId) {
            const existing = await db.from("leagues").select("id").eq("external_id", leagueExt).maybeSingle();
            if (existing.error) throw existing.error;
            if (existing.data?.id) leagueId = existing.data.id;
            else {
              const ins = await db.from("leagues").insert({ external_id: leagueExt, name: leagueName, country: e.strCountry ? String(e.strCountry) : null }).select("id").single();
              if (ins.error) throw ins.error;
              leagueId = ins.data.id;
              leaguesSaved++;
            }
            leagueCache.set(leagueExt, leagueId);
          }

          const ensureTeam = async (name: string, external: string, country: string | null) => {
            const cached = teamCache.get(external);
            if (cached) return cached;
            const existing = await db.from("teams").select("id").eq("external_id", external).maybeSingle();
            if (existing.error) throw existing.error;
            let id = existing.data?.id;
            if (!id) {
              const ins = await db.from("teams").insert({ league_id: leagueId, name, short_name: null, country, external_id: external, is_active: true }).select("id").single();
              if (ins.error) throw ins.error;
              id = ins.data.id;
              teamsSaved++;
            }
            teamCache.set(external, id);
            return id;
          };

          const homeId = await ensureTeam(homeName, `tsdb:${String(e.idHomeTeam ?? homeName)}`, e.strCountry ? String(e.strCountry) : null);
          const awayId = await ensureTeam(awayName, `tsdb:${String(e.idAwayTeam ?? awayName)}`, e.strCountry ? String(e.strCountry) : null);

          const dateTime = `${e.dateEvent}T${String(e.strTime ?? "00:00:00").slice(0, 8)}Z`;
          const homeScore = e.intHomeScore !== null && e.intHomeScore !== undefined && e.intHomeScore !== "" ? Number(e.intHomeScore) : null;
          const awayScore = e.intAwayScore !== null && e.intAwayScore !== undefined && e.intAwayScore !== "" ? Number(e.intAwayScore) : null;
          const status = homeScore !== null && awayScore !== null ? "FT" : "NS";

          const row = {
            league_id: leagueId,
            home_team_id: homeId,
            away_team_id: awayId,
            kickoff_at: new Date(dateTime).toISOString(),
            status,
            home_score: Number.isFinite(homeScore) ? homeScore : null,
            away_score: Number.isFinite(awayScore) ? awayScore : null,
            external_id: eventId,
            season: String(e.strSeason ?? ""),
            round: e.intRound ? String(e.intRound) : null,
          };
          const up = await db.from("matches").upsert(row, { onConflict: "external_id" }).select("id").single();
          if (up.error) throw up.error;
          if (up.data?.id) matchesSaved++;
        }
      } catch (err) {
        errors.push(`${date}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return out({ ok: errors.length === 0, action, days: 8, events_fetched: eventsFetched, leagues_saved: leaguesSaved, teams_saved: teamsSaved, matches_saved: matchesSaved, errors });
  } catch (err) {
    return out({ ok: false, action, error: err instanceof Error ? err.message : String(err), events_fetched: eventsFetched, leagues_saved: leaguesSaved, teams_saved: teamsSaved, matches_saved: matchesSaved, errors }, 502);
  }
});
