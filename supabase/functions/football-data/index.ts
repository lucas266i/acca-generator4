import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const API="https://v3.football.api-sports.io";
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,"Content-Type":"application/json"}});
async function api(path:string,key:string){const r=await fetch(`${API}${path}`,{headers:{"x-apisports-key":key,Accept:"application/json"}});const d=await r.json();if(!r.ok)throw new Error(`API-Football ${r.status}`);return d;}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 if(!["GET","POST"].includes(req.method))return out({ok:false,error:"Method not allowed"},405);
 const key=Deno.env.get("API_FOOTBALL_KEY"),url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key||!url||!service)return out({ok:false,error:"Server configuration incomplete"},500);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});let b:any={};try{if(req.method==="POST")b=await req.json()}catch{}
 const q=new URL(req.url),action=String(b.action??q.searchParams.get("action")??"countries"),league=String(b.league??q.searchParams.get("league")??""),season=String(b.season??q.searchParams.get("season")??"2026"),country=String(b.country??q.searchParams.get("country")??"Colombia");
 try{
  if(action==="countries")return out({ok:true,action,response:await api("/countries",key)});
  if(action==="leagues")return out({ok:true,action,response:await api(`/leagues?country=${encodeURIComponent(country)}&season=${encodeURIComponent(season)}`,key)});
  if(["teams","sync_teams"].includes(action)){
   if(!league)return out({ok:false,error:"league is required"},400);const r=await api(`/teams?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`,key);if(action==="teams")return out({ok:true,action,response:r});
   const l=(await db.from("leagues").select("id,external_id,name").eq("external_id",league).maybeSingle()).data;if(!l)return out({ok:false,error:"League is not stored in Supabase"},409);
   const rows=(r.response??[]).filter((x:any)=>x?.team?.id&&x?.team?.name).map((x:any)=>({league_id:l.id,name:String(x.team.name),short_name:x.team.code?String(x.team.code):null,country:x.team.country?String(x.team.country):null,external_id:String(x.team.id),is_active:true}));
   const up=await db.from("teams").upsert(rows,{onConflict:"external_id").select("id,league_id,name,short_name,country,external_id,is_active");if(up.error)throw up.error;return out({ok:true,action,season,league:l,fetched:rows.length,upserted:up.data?.length??0});
  }
  if(action==="sync_fixtures"){
   if(!league)return out({ok:false,error:"league is required"},400);const r=await api(`/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`,key);const l=(await db.from("leagues").select("id,external_id,name").eq("external_id",league).maybeSingle()).data;if(!l)return out({ok:false,error:"League is not stored in Supabase"},409);
   const ids=new Set<string>();for(const x of r.response??[]){if(x?.teams?.home?.id)ids.add(String(x.teams.home.id));if(x?.teams?.away?.id)ids.add(String(x.teams.away.id));}
   const tr=await db.from("teams").select("id,external_id").in("external_id",[...ids]);if(tr.error)throw tr.error;const tm=new Map((tr.data??[]).map((x:any)=>[String(x.external_id),x.id]));
   const rows=(r.response??[]).filter((x:any)=>x?.fixture?.id&&x?.fixture?.date&&tm.has(String(x.teams.home.id))&&tm.has(String(x.teams.away.id))).map((x:any)=>({league_id:l.id,home_team_id:tm.get(String(x.teams.home.id)),away_team_id:tm.get(String(x.teams.away.id)),kickoff_at:new Date(x.fixture.date).toISOString(),status:String(x.fixture.status?.short??"NS"),home_score:Number.isInteger(x.goals?.home)?x.goals.home:null,away_score:Number.isInteger(x.goals?.away)?x.goals.away:null,external_id:String(x.fixture.id),season,round:x.league?.round?String(x.league.round):null}));
   const up=rows.length?await db.from("matches").upsert(rows,{onConflict:"external_id"}).select("id,external_id,kickoff_at,status"):null;if(up?.error)throw up.error;return out({ok:true,action,season,fetched:(r.response??[]).length,mapped:rows.length,upserted:up?.data?.length??0});
  }
  if(action==="sync_statistics"){
   const ids=Array.isArray(b.fixture_ids)?b.fixture_ids.map(String).filter(Boolean):[];if(!ids.length)return out({ok:false,error:"fixture_ids is required"},400);let fetched=0,saved=0,errors:string[]=[];
   for(let i=0;i<ids.length;i+=20){const batch=ids.slice(i,i+20);try{const r=await api(`/fixtures?ids=${batch.join("-")}`,key);fetched+=(r.response??[]).length;for(const f of r.response??[]){const ext=String(f?.fixture?.id??"");const m=(await db.from("matches").select("id").eq("external_id",ext).maybeSingle()).data;if(!m)continue;for(const e of Array.isArray(f.statistics)?f.statistics:[]){const s=e?.statistics??[];const val=(t:string)=>s.find((x:any)=>x.type===t)?.value;const num=(v:any)=>typeof v==="number"?v:(typeof v==="string"&&v.trim()?Number(v):null);const pct=(v:any)=>typeof v==="string"?Number(v.replace("%","")):typeof v==="number"?v:null;const team=(await db.from("teams").select("id").eq("external_id",String(e?.team?.id??"")).maybeSingle()).data;if(!team)continue;const row={match_id:m.id,team_id:team.id,possession:pct(val("Ball Possession")),shots:num(val("Total Shots")),shots_on_target:num(val("Shots on Goal")),corners:num(val("Corner Kicks")),yellow_cards:num(val("Yellow Cards")),red_cards:num(val("Red Cards")),fouls:num(val("Fouls")),offsides:num(val("Offsides"))};const up=await db.from("match_stats").upsert(row,{onConflict:"match_id,team_id"});if(up.error)throw up.error;saved++;}}}catch(e){errors.push(e instanceof Error?e.message:"batch error")}}
   return out({ok:errors.length===0,action,requested:ids.length,fetched,saved,errors});
  }
  return out({ok:false,error:"Unknown action",available_actions:["countries","leagues","teams","sync_teams","sync_fixtures","sync_statistics"]},400);
 }catch(e){return out({ok:false,error:e instanceof Error?e.message:"Operation failed"},502)}
});