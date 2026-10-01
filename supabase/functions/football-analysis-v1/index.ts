import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://v3.football.api-sports.io";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function api(path: string, key: string) {
  const response = await fetch(API + path, {
    headers: { "x-apisports-key": key, Accept: "application/json" },
  });
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return {
    http_status: response.status,
    ok: response.ok,
    data,
  };
}

const clean = (v: any) => String(v ?? "").trim();
const num = (v: any) => {
  const n = Number(String(v ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : null;
};
const responseItems = (x: any) =>
  Array.isArray(x?.data?.response) ? x.data.response.length : 0;
const responseErrors = (x: any) => x?.data?.errors ?? null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const key = Deno.env.get("API_FOOTBALL_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!key || !url || !service || !anon) {
    return out({ ok: false, error: "Server configuration incomplete" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return out({ ok: false, error: "Authorization Bearer JWT required" }, 401);
  }

  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await auth.auth.getUser(
    authorization.slice(7),
  );
  if (authError || !authData.user) {
    return out({ ok: false, error: "Invalid or expired Supabase JWT" }, 401);
  }

  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try {
    if (req.method === "POST") body = await req.json();
  } catch {}
  const query = new URL(req.url);
  const action = String(body.action ?? query.searchParams.get("action") ?? "");

  if (action === "prediction" || action === "odds") {
    const fixture = clean(body.fixture ?? query.searchParams.get("fixture"));
    if (!fixture) return out({ ok: false, error: "fixture is required" }, 400);
    const endpoint = action === "prediction"
      ? `/predictions?fixture=${encodeURIComponent(fixture)}`
      : `/odds?fixture=${encodeURIComponent(fixture)}`;
    const result = await api(endpoint, key);
    return out({
      ok: result.ok,
      action,
      fixture,
      endpoint,
      http_status: result.http_status,
      results: result.data?.results ?? 0,
      errors: result.data?.errors ?? null,
      response_items: Array.isArray(result.data?.response) ? result.data.response.length : 0,
      response: result.data?.response ?? [],
    });
  }

  if (action !== "sync_analysis") {
    return out({
      ok: false,
      error: "Unknown action",
      available_actions: ["sync_analysis", "prediction", "odds"],
    }, 400);
  }

  const ids = Array.isArray(body.fixture_ids)
    ? body.fixture_ids.map(String).filter(Boolean).slice(0, 30)
    : [];
  if (!ids.length) return out({ ok: false, error: "fixture_ids is required" }, 400);

  const { data: markets, error: marketError } = await db
    .from("markets")
    .select("id,code")
    .eq("is_active", true);
  if (marketError) {
    return out({ ok: false, error: `markets: ${marketError.message}` }, 200);
  }

  const mids = new Map((markets ?? []).map((m: any) => [String(m.code).toUpperCase(), Number(m.id)]));
  const marketCodes = Array.from(mids.keys());
  const firstMarketId = (...codes: string[]) => {
    for (const code of codes) {
      const id = mids.get(code.toUpperCase());
      if (id) return id;
    }
    return null;
  };

  const resolved: any[] = [];
  const unresolved: string[] = [];
  for (const raw of ids) {
    const { data: match, error } = await db
      .from("matches")
      .select("id,external_id,kickoff_at,league_id")
      .eq("external_id", raw)
      .maybeSingle();
    if (error) {
      unresolved.push(`${raw}: ${error.message}`);
    } else if (match) {
      resolved.push(match);
    } else {
      unresolved.push(raw);
    }
  }

  let predictionsSaved = 0;
  let oddsSaved = 0;
  let statsSaved = 0;
  const errors: any[] = [];
  const samples: any[] = [];

  for (const match of resolved) {
    const fixture = String(match.external_id);
    const predictionResult = await api(`/predictions?fixture=${encodeURIComponent(fixture)}`, key);
    const oddsResult = await api(`/odds?fixture=${encodeURIComponent(fixture)}`, key);
    const statisticsResult = await api(`/fixtures/statistics?fixture=${encodeURIComponent(fixture)}`, key);

    const sample: any = {
      fixture,
      prediction: {
        http_status: predictionResult.http_status,
        results: predictionResult.data?.results ?? 0,
        response_items: responseItems(predictionResult),
        errors: responseErrors(predictionResult),
      },
      odds: {
        http_status: oddsResult.http_status,
        results: oddsResult.data?.results ?? 0,
        response_items: responseItems(oddsResult),
        errors: responseErrors(oddsResult),
      },
      statistics: {
        http_status: statisticsResult.http_status,
        results: statisticsResult.data?.results ?? 0,
        response_items: responseItems(statisticsResult),
        errors: responseErrors(statisticsResult),
      },
    };
    if (samples.length < 3) samples.push(sample);

    if (!predictionResult.ok || (predictionResult.data?.errors && Object.keys(predictionResult.data.errors).length)) {
      errors.push({ fixture, source: "predictions", http_status: predictionResult.http_status, error: predictionResult.data?.errors ?? `HTTP ${predictionResult.http_status}` });
    }
    if (!oddsResult.ok || (oddsResult.data?.errors && Object.keys(oddsResult.data.errors).length)) {
      errors.push({ fixture, source: "odds", http_status: oddsResult.http_status, error: oddsResult.data?.errors ?? `HTTP ${oddsResult.http_status}` });
    }
    if (!statisticsResult.ok || (statisticsResult.data?.errors && Object.keys(statisticsResult.data.errors).length)) {
      errors.push({ fixture, source: "statistics", http_status: statisticsResult.http_status, error: statisticsResult.data?.errors ?? `HTTP ${statisticsResult.http_status}` });
    }

    try {
      const prediction = predictionResult.data?.response?.[0]?.predictions;
      const predictionMarketId = firstMarketId("MATCH_RESULT", "1X2", "RESULT", "MATCH_WINNER", "WINNER");
      const percent = prediction?.percent;

      if (percent && predictionMarketId) {
        const rows: any[] = [];
        for (const item of [
          { selection: "Home", value: percent.home },
          { selection: "Draw", value: percent.draw },
          { selection: "Away", value: percent.away },
        ]) {
          const n = num(item.value);
          if (n !== null) {
            const probability = n / 100;
            rows.push({
              match_id: match.id,
              market_id: predictionMarketId,
              selection: item.selection,
              probability,
              fair_odd: probability > 0 ? 1 / probability : null,
              confidence: probability,
              model_version: "api-football-predictions",
              generated_at: new Date().toISOString(),
            });
          }
        }
        if (rows.length) {
          const del = await db.from("predictions").delete().eq("match_id", match.id);
          if (del.error) throw del.error;
          const ins = await db.from("predictions").insert(rows);
          if (ins.error) throw ins.error;
          predictionsSaved += rows.length;
        }
      } else if (prediction && !predictionMarketId) {
        errors.push({ fixture, source: "predictions", error: "Prediction data exists but no active result market was found", active_market_codes: marketCodes });
      }

      const bookmakers = Array.isArray(oddsResult.data?.response?.[0]?.bookmakers)
        ? oddsResult.data.response[0].bookmakers
        : [];
      const oddsRows: any[] = [];
      for (const bookmaker of bookmakers) {
        const bookmakerName = clean(bookmaker?.name ?? bookmaker?.id ?? "Unknown");
        for (const bet of bookmaker?.bets ?? []) {
          const name = clean(bet?.name).toLowerCase();
          for (const value of bet?.values ?? []) {
            const selection = clean(value?.value);
            const low = selection.toLowerCase();
            let code: string | null = null;
            if ((name.includes("match winner") || name.includes("1x2")) && ["home", "draw", "away"].includes(low)) code = "MATCH_RESULT";
            else if (name.includes("both teams") && ["yes", "no"].includes(low)) code = low === "yes" ? "BTTS_YES" : "BTTS_NO";
            else if ((name.includes("over/under") || name.includes("goals over/under")) && low.includes("over 1.5")) code = "OVER_1_5";
            else if ((name.includes("over/under") || name.includes("goals over/under")) && low.includes("over 2.5")) code = "OVER_2_5";
            else if (name.includes("corner") && low.includes("over 7.5")) code = "CORNERS_OVER_7_5";
            else if (name.includes("corner") && low.includes("over 8.5")) code = "CORNERS_OVER_8_5";
            else if (name.includes("corner") && low.includes("over 9.5")) code = "CORNERS_OVER_9_5";

            const marketId = code ? firstMarketId(code) : null;
            const odd = num(value?.odd);
            if (marketId && odd !== null && odd > 1) {
              oddsRows.push({
                match_id: match.id,
                market_id: marketId,
                bookmaker: bookmakerName,
                selection,
                line: value?.handicap != null ? num(value.handicap) : null,
                odd,
                observed_at: new Date().toISOString(),
                external_id: `${fixture}-${bookmakerName}-${bet?.id ?? name}-${selection}-${value?.handicap ?? ""}`,
              });
            }
          }
        }
      }
      if (oddsRows.length) {
        const ins = await db.from("odds").upsert(oddsRows, { onConflict: "external_id" });
        if (ins.error) throw ins.error;
        oddsSaved += oddsRows.length;
      }

      const statRows: any[] = [];
      for (const teamStat of Array.isArray(statisticsResult.data?.response) ? statisticsResult.data.response : []) {
        const teamExternalId = String(teamStat?.team?.id ?? "");
        if (!teamExternalId) continue;
        const { data: team } = await db.from("teams").select("id").eq("external_id", teamExternalId).maybeSingle();
        if (!team) continue;
        const values: any = {};
        for (const item of teamStat?.statistics ?? []) values[String(item?.type ?? "").toLowerCase()] = item?.value;
        statRows.push({
          match_id: match.id,
          team_id: team.id,
          possession: num(values["ball possession"]),
          shots: num(values["total shots"]),
          shots_on_target: num(values["shots on goal"]),
          corners: num(values["corner kicks"]),
          yellow_cards: num(values["yellow cards"]),
          red_cards: num(values["red cards"]),
          fouls: num(values["fouls"]),
          offsides: num(values["offsides"]),
        });
      }
      if (statRows.length) {
        const del = await db.from("match_stats").delete().eq("match_id", match.id);
        if (del.error) throw del.error;
        const ins = await db.from("match_stats").insert(statRows);
        if (ins.error) throw ins.error;
        statsSaved += statRows.length;
      }
    } catch (error) {
      errors.push({ fixture, source: "database", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return out({
    ok: true,
    partial: errors.length > 0,
    action,
    user_id: authData.user.id,
    requested: ids.length,
    resolved: resolved.length,
    processed: resolved.length,
    unresolved,
    predictions_saved: predictionsSaved,
    odds_saved: oddsSaved,
    stats_saved: statsSaved,
    active_market_codes: marketCodes,
    samples,
    errors: errors.slice(0, 50),
  });
});
