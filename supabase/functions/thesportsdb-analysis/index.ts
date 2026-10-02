import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const clamp=(n:number)=>Math.max(.5,Math.min(.99,n));
const rate=(a:boolean[])=>a.length?a.filter(Boolean).length/a.length:null;
const chunks=<T>(items:T[],size:number)=>{const r:T[][]=[];for(let i=0;i<items.length;i+=size)r.push(items.slice(i,i+size));return r};

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return out({ok:false,error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return out({ok:false,error:"Supabase server configuration incomplete"},500);
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)return out({ok:false,error:"Authorization required"},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const user=await db.auth.getUser(token);
  if(user.error||!user.data.user)return out({ok:false,error:"Invalid or expired session"},401);
  let body:any={};try{body=await req.json()}catch{return out({ok:false,error:"Invalid JSON body"},400)}
  const ids=(Array.isArray(body.fixture_ids)?body.fixture_ids:[]).map(String).filter(Boolean).slice(0,100);
  if(!ids.length)return out({ok:false,error:"fixture_ids is required"},400);

  const [mr,hr,markets]=await Promise.all([
   db.from("matches").select("id,external_id,league_id,kickoff_at,home_team_id,away_team_id,home_score,away_score").in("external_id",ids),
   db.from("matches").select("id,league_id,home_team_id,away_team_id,kickoff_at,home_score,away_score").not("home_score","is",null).not("away_score","is",null).order("kickoff_at",{ascending:false}).limit(5000),
   db.from("markets").select("id,code,name,category").eq("is_active",true)
  ]);
  if(mr.error||hr.error||markets.error)return out({ok:false,error:(mr.error||hr.error||markets.error)?.message||"Database read failed",stage:"load"},500);

  const marketRows=markets.data||[];
  const mids=new Map(marketRows.map((m:any)=>[String(m.code).toUpperCase(),m.id]));
  const findMarket=(codes:string[])=>{for(const c of codes){const id=mids.get(c.toUpperCase());if(id)return id}const wanted=codes.map(x=>x.toUpperCase());return marketRows.find((m:any)=>wanted.includes(String(m.name||"").toUpperCase()))?.id||null};
  const history=hr.data||[];
  const byTeam=new Map<string,any[]>();
  const byLeague=new Map<string,any[]>();
  for(const g of history){
   const leagueKey=String(g.league_id||"");
   if(leagueKey){const la=byLeague.get(leagueKey)||[];if(la.length<100)la.push(g);byLeague.set(leagueKey,la)}
   for(const teamId of [g.home_team_id,g.away_team_id]){
    const k=String(teamId);const arr=byTeam.get(k)||[];if(arr.length<10)arr.push(g);byTeam.set(k,arr);
   }
  }

  const generated:any[]=[];
  for(const m of (mr.data||[])){
   const teamHome=byTeam.get(String(m.home_team_id))||[];
   const teamAway=byTeam.get(String(m.away_team_id))||[];
   const leagueHistory=byLeague.get(String(m.league_id||""))||[];
   // Prefer team history; fall back to league history when a newly imported team has no completed games.
   // This keeps the model data-driven instead of returning an apparently successful 0/0 analysis.
   const home=teamHome.length>=3?teamHome:leagueHistory;
   const away=teamAway.length>=3?teamAway:leagueHistory;
   const all=[...new Map([...home,...away].map(g=>[String(g.id),g])).values()];
   const rows:any[]=[];
   const resultId=findMarket(["MATCH_RESULT","1X2","RESULT"]);
   if(resultId&&home.length&&away.length){
    const hw=rate(home.map(g=>String(g.home_team_id)===String(m.home_team_id)?Number(g.home_score)>Number(g.away_score):String(g.away_team_id)===String(m.home_team_id)?Number(g.away_score)>Number(g.home_score):Number(g.home_score)>Number(g.away_score)));
    const aw=rate(away.map(g=>String(g.home_team_id)===String(m.away_team_id)?Number(g.home_score)>Number(g.away_score):String(g.away_team_id)===String(m.away_team_id)?Number(g.away_score)>Number(g.home_score):Number(g.away_score)>Number(g.home_score)));
    const dr=rate(all.map(g=>Number(g.home_score)===Number(g.away_score)));
    if(hw!==null&&aw!==null&&dr!==null){
     const raw=[.2+.55*hw+.25*(1-aw),.15+.7*dr,.2+.55*aw+.25*(1-hw)],sum=raw.reduce((a,b)=>a+b,0);
     [["Home",raw[0]/sum],["Draw",raw[1]/sum],["Away",raw[2]/sum]].forEach(([selection,p]:any)=>{const probability=clamp(Number(p));rows.push({match_id:m.id,market_id:resultId,selection,probability,fair_odd:Number((1/probability).toFixed(3)),confidence:probability,model_version:"thesportsdb-form-v4",generated_at:new Date().toISOString()})});
    }
   }
   const totals=all.map(g=>Number(g.home_score)+Number(g.away_score)).filter(Number.isFinite),btts=all.map(g=>Number(g.home_score)>0&&Number(g.away_score)>0);
   const simple:[[string,string,number|null,string[]],[string,string,number|null,string[]],[string,string,number|null,string[]]]=[
    ["BTTS_YES","Yes",rate(btts),["BTTS_YES","BTTS"]],["OVER_1_5","Over 1.5",rate(totals.map(x=>x>1)),["OVER_1_5"]],["OVER_2_5","Over 2.5",rate(totals.map(x=>x>2)),["OVER_2_5"]]
   ];
   for(const [,selection,p,codes] of simple){const id=findMarket(codes);if(!id||p===null)continue;const probability=clamp(Number(p));rows.push({match_id:m.id,market_id:id,selection,probability,fair_odd:Number((1/probability).toFixed(3)),confidence:probability,model_version:"thesportsdb-form-v4",generated_at:new Date().toISOString()})}
   const unique=[...new Map(rows.map(r=>[`${r.market_id}|${r.selection}`,r])).values()];
   generated.push({match:m,history:all.length,home_history:teamHome.length,away_history:teamAway.length,league_history:leagueHistory.length,fallback_used:teamHome.length<3||teamAway.length<3,rows:unique});
  }

  const matchIds=generated.map(x=>x.match.id);
  for(const idsChunk of chunks(matchIds,200)){
   const d1=await db.from("predictions").delete().in("match_id",idsChunk);if(d1.error)throw new Error(`prediction delete: ${d1.error.message}`);
   const d2=await db.from("odds").delete().in("match_id",idsChunk).eq("bookmaker","MODEL_FAIR");if(d2.error)throw new Error(`model fair delete: ${d2.error.message}`);
  }

  const predictionRows=generated.flatMap(x=>x.rows);
  const oddsRows=predictionRows.map(r=>({match_id:r.match_id,market_id:r.market_id,bookmaker:"MODEL_FAIR",selection:r.selection,line:null,odd:r.fair_odd,observed_at:new Date().toISOString(),external_id:`model-${r.match_id}-${r.market_id}-${String(r.selection).replace(/[^a-z0-9]+/gi,"-")}`}));
  for(const rows of chunks(predictionRows,500)){if(!rows.length)continue;const r=await db.from("predictions").insert(rows);if(r.error)throw new Error(`prediction insert: ${r.error.message}`)}
  for(const rows of chunks(oddsRows,500)){if(!rows.length)continue;const r=await db.from("odds").insert(rows);if(r.error)throw new Error(`odds insert: ${r.error.message}`)}

  const result=generated.map(x=>({fixture:x.match.external_id,history:x.history,home_history:x.home_history,away_history:x.away_history,league_history:x.league_history,fallback_used:x.fallback_used,predictions:x.rows.length,predictionsSaved:x.rows.length,oddsSaved:x.rows.length,...(!x.rows.length?{warning:"No active markets or no historical results available for this fixture"}:{})}));
  return out({ok:true,user_id:user.data.user.id,requested:ids.length,resolved:generated.length,predictions_saved:predictionRows.length,odds_saved:oddsRows.length,odds_source:"MODEL_FAIR",warning:"MODEL_FAIR is a calculated fair price, not a bookmaker quote",generated:result});
 }catch(error){return out({ok:false,error:error instanceof Error?error.message:String(error),stage:"unhandled"},500)}
});
