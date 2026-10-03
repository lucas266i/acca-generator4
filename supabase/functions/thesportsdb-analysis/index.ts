import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const chunks=<T>(a:T[],n:number)=>{const r:T[][]=[];for(let i=0;i<a.length;i+=n)r.push(a.slice(i,i+n));return r};
const clamp=(n:number,min=.03,max=.99)=>Math.max(min,Math.min(max,n));
const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const rate=(a:boolean[])=>a.length?a.filter(Boolean).length/a.length:null;
const poisson=(lambda:number,k:number)=>{let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p};
const poissonUnder=(lambda:number,k:number)=>{let s=0;for(let i=0;i<=k;i++)s+=poisson(lambda,i);return s};

function outcomeProb(home:any[],away:any[],homeId:any,awayId:any){
  const hp=home.map(g=>String(g.home_team_id)===String(homeId)?[Number(g.home_score),Number(g.away_score)]:[Number(g.away_score),Number(g.home_score)]);
  const ap=away.map(g=>String(g.away_team_id)===String(awayId)?[Number(g.away_score),Number(g.home_score)]:[Number(g.home_score),Number(g.away_score)]);
  const hw=rate(hp.map(x=>x[0]>x[1])),aw=rate(ap.map(x=>x[0]>x[1]));
  const hd=rate(hp.map(x=>x[0]===x[1])),ad=rate(ap.map(x=>x[0]===x[1]));
  if(hw===null||aw===null||hd===null||ad===null)return null;
  const h=0.58*hw+0.22*(1-aw)+0.20*(1-ad);
  const a=0.58*aw+0.22*(1-hw)+0.20*(1-hd);
  const d=0.5*hd+0.5*ad;const sum=h+d+a;
  return {home:h/sum,draw:d/sum,away:a/sum};
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return out({ok:false,error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return out({ok:false,error:"Supabase server configuration incomplete"},500);
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)return out({ok:false,error:"Authorization required"},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const user=await db.auth.getUser(token);if(user.error||!user.data.user)return out({ok:false,error:"Invalid or expired session"},401);
  let body:any={};try{body=await req.json()}catch{return out({ok:false,error:"Invalid JSON body"},400)}
  const ids=(Array.isArray(body.fixture_ids)?body.fixture_ids:[]).map(String).filter(Boolean).slice(0,100);
  if(!ids.length)return out({ok:false,error:"fixture_ids is required"},400);

  const [mr,hr,markets]=await Promise.all([
   db.from("matches").select("id,external_id,league_id,kickoff_at,home_team_id,away_team_id,home_score,away_score").in("external_id",ids),
   db.from("matches").select("id,league_id,home_team_id,away_team_id,kickoff_at,home_score,away_score").not("home_score","is",null).not("away_score","is",null).order("kickoff_at",{ascending:false}).limit(10000),
   db.from("markets").select("id,code,name,category").eq("is_active",true)
  ]);
  if(mr.error||hr.error||markets.error)return out({ok:false,error:(mr.error||hr.error||markets.error)?.message||"Database read failed",stage:"load"},500);

  const history=hr.data||[],marketRows=markets.data||[];
  const mids=new Map(marketRows.map((m:any)=>[String(m.code).toUpperCase(),m.id]));
  const mid=(code:string)=>mids.get(code.toUpperCase())||null;

  const historyIds=history.map((x:any)=>x.id).filter(Boolean),stats:any[]=[];
  for(const c of chunks(historyIds,500)){if(!c.length)continue;const r=await db.from("match_stats").select("match_id,team_id,possession,shots,shots_on_target,corners,yellow_cards,red_cards,fouls,offsides").in("match_id",c);if(r.error)return out({ok:false,error:`match_stats: ${r.error.message}`,stage:"stats"},500);stats.push(...(r.data||[]))}
  const statsByMatch=new Map<number,any[]>();for(const s of stats){const a=statsByMatch.get(Number(s.match_id))||[];a.push(s);statsByMatch.set(Number(s.match_id),a)}

  const byTeam=new Map<string,any[]>();
  for(const g of history)for(const tid of [g.home_team_id,g.away_team_id]){const k=String(tid),a=byTeam.get(k)||[];if(a.length<50)a.push(g);byTeam.set(k,a)}

  const generated:any[]=[];
  for(const m of (mr.data||[])){
   const allTeam=byTeam.get(String(m.home_team_id))||[],allAway=byTeam.get(String(m.away_team_id))||[];
   const homeOverall=allTeam.slice(0,5),awayOverall=allAway.slice(0,5);
   const homeVenue=allTeam.filter(g=>String(g.home_team_id)===String(m.home_team_id)).slice(0,5);
   const awayVenue=allAway.filter(g=>String(g.away_team_id)===String(m.away_team_id)).slice(0,5);
   const league=history.filter(g=>String(g.league_id)===String(m.league_id)).slice(0,5);
   const result=outcomeProb(homeVenue.length>=3?homeVenue:homeOverall,awayVenue.length>=3?awayVenue:awayOverall,m.home_team_id,m.away_team_id);

   const hp=(homeVenue.length?homeVenue:homeOverall).map(g=>String(g.home_team_id)===String(m.home_team_id)?[Number(g.home_score),Number(g.away_score)]:[Number(g.away_score),Number(g.home_score)]);
   const ap=(awayVenue.length?awayVenue:awayOverall).map(g=>String(g.away_team_id)===String(m.away_team_id)?[Number(g.away_score),Number(g.home_score)]:[Number(g.home_score),Number(g.away_score)]);
   const ho=homeOverall.map(g=>String(g.home_team_id)===String(m.home_team_id)?[Number(g.home_score),Number(g.away_score)]:[Number(g.away_score),Number(g.home_score)]);
   const ao=awayOverall.map(g=>String(g.away_team_id)===String(m.away_team_id)?[Number(g.away_score),Number(g.home_score)]:[Number(g.home_score),Number(g.away_score)]);
   const hAttack=avg(hp.map(x=>x[0]))??avg(ho.map(x=>x[0]))??1.2,hDef=avg(hp.map(x=>x[1]))??avg(ho.map(x=>x[1]))??1.2;
   const aAttack=avg(ap.map(x=>x[0]))??avg(ao.map(x=>x[0]))??1.1,aDef=avg(ap.map(x=>x[1]))??avg(ao.map(x=>x[1]))??1.2;
   let lambdaH=0.58*hAttack+0.42*aDef,lambdaA=0.58*aAttack+0.42*hDef;
   const lg=league.map(g=>[Number(g.home_score),Number(g.away_score)]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
   const lgH=avg(lg.map(x=>x[0])),lgA=avg(lg.map(x=>x[1]));
   if(lgH!==null)lambdaH=.85*lambdaH+.15*lgH;if(lgA!==null)lambdaA=.85*lambdaA+.15*lgA;
   lambdaH=Math.max(.15,Math.min(3.8,lambdaH));lambdaA=Math.max(.15,Math.min(3.5,lambdaA));

   // Cached last-5 form context. If the migration has not been applied yet, the model continues safely.
   let formContext:any={available:false,home:null,away:null};
   try{
    const fr=await db.from("team_form_snapshots").select("team_id,venue,sample_size,goals_for_avg,goals_against_avg,wins_rate,draws_rate,losses_rate,corners_avg,shots_avg,shots_on_target_avg,cards_avg").eq("match_id",m.id);
    if(!fr.error&&fr.data?.length){formContext={available:true,home:fr.data.find((x:any)=>String(x.team_id)===String(m.home_team_id)&&x.venue==='home')||null,away:fr.data.find((x:any)=>String(x.team_id)===String(m.away_team_id)&&x.venue==='away')||null}}
   }catch{}

   // Lineup context is applied only when actual published lineup rows exist. Missing lineups never reduce confidence by assumption.
   let lineupContext:any={available:false,home_players:0,away_players:0,home_starters:0,away_starters:0};
   try{
    const lr=await db.from("match_lineups").select("team_id,substitute,captain").eq("match_id",m.id);
    if(!lr.error&&lr.data?.length){
      const home=lr.data.filter((x:any)=>String(x.team_id)===String(m.home_team_id)),away=lr.data.filter((x:any)=>String(x.team_id)===String(m.away_team_id));
      lineupContext={available:true,home_players:home.length,away_players:away.length,home_starters:home.filter((x:any)=>!x.substitute).length,away_starters:away.filter((x:any)=>!x.substitute).length};
    }
   }catch{}

   const hSample=homeVenue.length||homeOverall.length,aSample=awayVenue.length||awayOverall.length;
   const dataScore=Math.min(1,(hSample+aSample)/10)*.65+Math.min(1,league.length/5)*.15+(statsByMatch.size? .2:0);
   const lineupScore=lineupContext.available?Math.min(1,(lineupContext.home_starters+lineupContext.away_starters)/22):0;
   const contextScore=Math.round((dataScore*.90+lineupScore*.10)*100)/100;
   const modelVersion="thesportsdb-form-v6";
   const rows:any[]=[];
   const add=(market:string,selection:string,p:number)=>{const id=mid(market);if(!id)return;const probability=clamp(Number(p));rows.push({match_id:m.id,market_id:id,selection,probability,fair_odd:Number((1/probability).toFixed(3)),confidence:Math.round((probability*.75+contextScore*.25)*1000)/1000,model_version:modelVersion,generated_at:new Date().toISOString()})};

   if(result){add("MATCH_RESULT","Home",result.home);add("MATCH_RESULT","Draw",result.draw);add("MATCH_RESULT","Away",result.away)}
   const total=lambdaH+lambdaA,pOver15=1-poissonUnder(total,1),pOver25=1-poissonUnder(total,2),pBtts=1-poisson(lambdaH,0)-poisson(lambdaA,0)+poisson(lambdaH,0)*poisson(lambdaA,0);
   add("OVER_1_5","Over 1.5",pOver15);add("OVER_2_5","Over 2.5",pOver25);add("BTTS_YES","Yes",pBtts);

   const statGames=[...new Map([...(homeVenue.length?homeVenue:homeOverall),...(awayVenue.length?awayVenue:awayOverall)].map(g=>[String(g.id),g])).values()].slice(0,10);
   const totals={corners:[] as number[],cards:[] as number[],sot:[] as number[],shots:[] as number[]};
   for(const g of statGames){const ss=statsByMatch.get(Number(g.id))||[];if(ss.length<2)continue;totals.corners.push(ss.reduce((s,x)=>s+(Number(x.corners)||0),0));totals.cards.push(ss.reduce((s,x)=>s+(Number(x.yellow_cards)||0)+(Number(x.red_cards)||0),0));totals.sot.push(ss.reduce((s,x)=>s+(Number(x.shots_on_target)||0),0));totals.shots.push(ss.reduce((s,x)=>s+(Number(x.shots)||0),0))}
   const statMarket=(code:string,selection:string,values:number[],threshold:number)=>{if(values.length<3)return;const id=mid(code);if(!id)return;add(code,selection,rate(values.map(v=>v>threshold))??.5)};
   statMarket("CORNERS_OVER_7_5","Over 7.5",totals.corners,7.5);statMarket("CORNERS_OVER_8_5","Over 8.5",totals.corners,8.5);statMarket("CORNERS_OVER_9_5","Over 9.5",totals.corners,9.5);statMarket("CARDS_OVER_2_5","Over 2.5",totals.cards,2.5);statMarket("SOT_OVER_7_5","Over 7.5",totals.sot,7.5);statMarket("SHOTS_OVER_20_5","Over 20.5",totals.shots,20.5);

   const unique=[...new Map(rows.map(r=>[`${r.market_id}|${r.selection}`,r])).values()];
   generated.push({match:m,history:{overall_home:homeOverall.length,home_venue:homeVenue.length,overall_away:awayOverall.length,away_venue:awayVenue.length,league:league.length},expected_goals:{home:Number(lambdaH.toFixed(3)),away:Number(lambdaA.toFixed(3))},stats_samples:{corners:totals.corners.length,cards:totals.cards.length,shots:totals.shots.length,sot:totals.sot.length},form_context:formContext,lineup_context:lineupContext,context_score:contextScore,rows:unique});
  }

  const matchIds=generated.map(x=>x.match.id);
  for(const c of chunks(matchIds,200)){const d1=await db.from("predictions").delete().in("match_id",c);if(d1.error)throw new Error(`prediction delete: ${d1.error.message}`);const d2=await db.from("odds").delete().in("match_id",c).eq("bookmaker","MODEL_FAIR");if(d2.error)throw new Error(`model fair delete: ${d2.error.message}`)}
  const predictionRows=generated.flatMap(x=>x.rows),oddsRows=predictionRows.map(r=>({match_id:r.match_id,market_id:r.market_id,bookmaker:"MODEL_FAIR",selection:r.selection,line:null,odd:r.fair_odd,observed_at:new Date().toISOString(),external_id:`model-v6-${r.match_id}-${r.market_id}-${String(r.selection).replace(/[^a-z0-9]+/gi,"-")}`}));
  for(const c of chunks(predictionRows,500)){if(c.length){const r=await db.from("predictions").insert(c);if(r.error)throw new Error(`prediction insert: ${r.error.message}`)}}
  for(const c of chunks(oddsRows,500)){if(c.length){const r=await db.from("odds").insert(c);if(r.error)throw new Error(`odds insert: ${r.error.message}`)}}
  return out({ok:true,user_id:user.data.user.id,requested:ids.length,resolved:generated.length,predictions_saved:predictionRows.length,odds_saved:oddsRows.length,odds_source:"MODEL_FAIR",model_version:modelVersion,methodology:{last5_overall:true,last5_home_for_home_team:true,last5_away_for_away_team:true,league_baseline:true,poisson_goals:true,match_stats_when_available:true,cached_form_snapshots:true,lineups_when_published:true},generated:generated.map(x=>({fixture:x.match.external_id,history:x.history,expected_goals:x.expected_goals,stats_samples:x.stats_samples,context_score:x.context_score,lineup_available:x.lineup_context.available,predictions:x.rows.length}))});
 }catch(error){return out({ok:false,error:error instanceof Error?error.message:String(error),stage:"unhandled"},500)}
});
