import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS"
};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const clamp=(n:number)=>Math.max(.5,Math.min(.99,n));
const rate=(a:boolean[])=>a.length?a.filter(Boolean).length/a.length:null;

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
  try{
    const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),anon=Deno.env.get("SUPABASE_ANON_KEY");
    if(!url||!service||!anon) return out({ok:false,error:"Supabase server configuration incomplete"},500);
    const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
    if(!token) return out({ok:false,error:"Authorization required"},401);
    const user=await auth.auth.getUser(token);
    if(user.error||!user.data.user) return out({ok:false,error:"Invalid session"},401);
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    let body:any={}; try{body=await req.json()}catch{}
    const ids=(body.fixture_ids||[]).map(String).filter(Boolean).slice(0,100);
    if(!ids.length) return out({ok:false,error:"fixture_ids is required"},400);

    const [mr,hr,markets]=await Promise.all([
      db.from("matches").select("id,external_id,kickoff_at,home_team_id,away_team_id,home_score,away_score").in("external_id",ids),
      db.from("matches").select("id,home_team_id,away_team_id,kickoff_at,home_score,away_score").not("home_score","is",null).not("away_score","is",null).order("kickoff_at",{ascending:false}).limit(5000),
      db.from("markets").select("id,code,name,category").eq("is_active",true)
    ]);
    if(mr.error||hr.error||markets.error) return out({ok:false,error:(mr.error||hr.error||markets.error)?.message||"Database read failed",stage:"load"},200);

    const marketRows=markets.data||[];
    const mids=new Map(marketRows.map((m:any)=>[String(m.code).toUpperCase(),m.id]));
    const findMarket=(codes:string[])=>{
      for(const c of codes){const id=mids.get(c.toUpperCase());if(id)return id;}
      const wanted=codes.map(x=>x.toUpperCase());
      return marketRows.find((m:any)=>wanted.includes(String(m.name||"").toUpperCase()))?.id||null;
    };

    const history=hr.data||[];
    let predictionsSaved=0,oddsSaved=0;
    const generated:any[]=[];

    for(const m of mr.data||[]){
      const home=history.filter(g=>String(g.home_team_id)===String(m.home_team_id)||String(g.away_team_id)===String(m.home_team_id)).slice(0,10);
      const away=history.filter(g=>String(g.home_team_id)===String(m.away_team_id)||String(g.away_team_id)===String(m.away_team_id)).slice(0,10);
      const all=[...home,...away];
      const rows:any[]=[];

      const resultId=findMarket(["MATCH_RESULT","1X2","RESULT"]);
      if(resultId){
        const hw=rate(home.map(g=>String(g.home_team_id)===String(m.home_team_id)?Number(g.home_score)>Number(g.away_score):Number(g.away_score)>Number(g.home_score)))??.4;
        const aw=rate(away.map(g=>String(g.home_team_id)===String(m.away_team_id)?Number(g.home_score)>Number(g.away_score):Number(g.away_score)>Number(g.home_score)))??.3;
        const dr=rate(all.map(g=>Number(g.home_score)===Number(g.away_score)))??.27;
        const raw=[.2+.55*hw+.25*(1-aw),.15+.7*dr,.2+.55*aw+.25*(1-hw)];
        const sum=raw.reduce((a,b)=>a+b,0);
        [["Home",raw[0]/sum],["Draw",raw[1]/sum],["Away",raw[2]/sum]].forEach(([selection,p]:any)=>{
          const probability=clamp(Number(p));
          rows.push({match_id:m.id,market_id:resultId,selection,probability,fair_odd:Number((1/probability).toFixed(3)),confidence:probability,model_version:"thesportsdb-form-v2",generated_at:new Date().toISOString()});
        });
      }

      const totals=all.map(g=>Number(g.home_score)+Number(g.away_score)).filter(Number.isFinite);
      const btts=all.map(g=>Number(g.home_score)>0&&Number(g.away_score)>0);
      const simple:[string,string,number,string[]][]=[
        ["BTTS_YES","Yes",rate(btts)??.55,["BTTS_YES","BTTS"]],
        ["OVER_1_5","Over 1.5",rate(totals.map(x=>x>1))??.75,["OVER_1_5"]],
        ["OVER_2_5","Over 2.5",rate(totals.map(x=>x>2))??.58,["OVER_2_5"]]
      ];
      for(const [,selection,p,codes] of simple){
        const id=findMarket(codes); if(!id) continue;
        const probability=clamp(Number(p));
        rows.push({match_id:m.id,market_id:id,selection,probability,fair_odd:Number((1/probability).toFixed(3)),confidence:probability,model_version:"thesportsdb-form-v2",generated_at:new Date().toISOString()});
      }

      const unique=[...new Map(rows.map(r=>[`${r.market_id}|${r.selection}`,r])).values()];
      const del=await db.from("predictions").delete().eq("match_id",m.id);
      if(del.error){generated.push({fixture:m.external_id,error:`prediction delete: ${del.error.message}`});continue;}
      const oldOdds=await db.from("odds").delete().eq("match_id",m.id).eq("bookmaker","MODEL_FAIR");
      if(oldOdds.error){generated.push({fixture:m.external_id,error:`model fair delete: ${oldOdds.error.message}`});continue;}

      if(unique.length){
        const ins=await db.from("predictions").insert(unique);
        if(ins.error){generated.push({fixture:m.external_id,error:`prediction insert: ${ins.error.message}`});continue;}
        predictionsSaved+=unique.length;
        const observedAt=new Date().toISOString();
        const fair=unique.map(r=>({match_id:m.id,market_id:r.market_id,bookmaker:"MODEL_FAIR",selection:r.selection,line:null,odd:r.fair_odd,observed_at:observedAt,external_id:`model-${m.id}-${r.market_id}-${String(r.selection).replace(/[^a-z0-9]+/gi,"-")}`}));
        const oi=await db.from("odds").insert(fair);
        if(!oi.error) oddsSaved+=fair.length;
        else generated.push({fixture:m.external_id,warning:`odds insert: ${oi.error.message}`});
      }
      generated.push({fixture:m.external_id,history:all.length,predictions:unique.length});
    }

    return out({ok:true,user_id:user.data.user.id,requested:ids.length,resolved:(mr.data||[]).length,predictions_saved:predictionsSaved,odds_saved:oddsSaved,odds_source:"MODEL_FAIR",warning:"MODEL_FAIR is a calculated fair price, not a bookmaker quote",generated});
  }catch(error){
    return out({ok:false,error:error instanceof Error?error.message:String(error),stage:"unhandled"},500);
  }
});
