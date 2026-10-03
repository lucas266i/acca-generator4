import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API="https://www.thesportsdb.com/api/v1/json";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const chunks=<T>(a:T[],n:number)=>{const r:T[][]=[];for(let i=0;i<a.length;i+=n)r.push(a.slice(i,i+n));return r};

async function tsdb(eventId:string,key:string){
  const r=await fetch(`${API}/${encodeURIComponent(key)}/lookuplineup.php?id=${encodeURIComponent(eventId)}`);
  const text=await r.text();let data:any={};
  try{data=JSON.parse(text)}catch{throw new Error(`TheSportsDB returned non-JSON (${r.status})`)}
  if(!r.ok)throw new Error(`TheSportsDB HTTP ${r.status}`);
  return Array.isArray(data?.lineup)?data.lineup:[];
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return out({ok:false,error:'Method not allowed'},405);
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),key=Deno.env.get('THESPORTSDB_API_KEY');
  if(!url||!service||!key)return out({ok:false,error:'Missing server configuration'},500);
  try{
    const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
    if(!token)return out({ok:false,error:'Authorization required'},401);
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const user=await db.auth.getUser(token);if(user.error||!user.data.user)return out({ok:false,error:'Invalid or expired session'},401);
    let body:any={};try{body=await req.json()}catch{return out({ok:false,error:'Invalid JSON body'},400)}
    const requested=Array.isArray(body.fixture_ids)?body.fixture_ids.map(String).filter(Boolean):[];
    const matches=requested.length?await db.from('matches').select('id,external_id').in('external_id',requested.slice(0,100)):await db.from('matches').select('id,external_id').gt('kickoff_at',new Date().toISOString()).order('kickoff_at',{ascending:true}).limit(100);
    if(matches.error)throw new Error(matches.error.message);
    const errors:string[]=[],rows:any[]=[];let fetched=0,eventsWithLineup=0;
    for(const m of (matches.data||[])){
      try{
        const lineup=await tsdb(String(m.external_id),key);fetched++;
        if(!lineup.length)continue;eventsWithLineup++;
        for(const x of lineup){
          const playerName=String(x.strPlayer??x.strPlayerName??x.strName??'').trim();if(!playerName)continue;
          rows.push({
            match_id:m.id,
            team_id:null,
            player_id:x.idPlayer?Number(x.idPlayer):null,
            player_name:playerName,
            position:x.strPosition??null,
            lineup_status:x.strLineup??x.strStatus??null,
            jersey_number:x.intSquadNumber??x.strNumber??null,
            formation_position:x.strFormation??null,
            captain:String(x.strCaptain??'').toLowerCase()==='yes'||x.strCaptain===true,
            substitute:String(x.strSubstitute??'').toLowerCase()==='yes'||x.strSubstitute===true,
            source:'TheSportsDB',
            raw_data:x,
            updated_at:new Date().toISOString()
          });
        }
      }catch(e){errors.push(`${m.external_id}: ${e instanceof Error?e.message:String(e)}`)}
    }
    for(const c of chunks(rows,500)){
      if(!c.length)continue;
      const r=await db.from('match_lineups').upsert(c,{onConflict:'match_id,player_name'});
      if(r.error)throw new Error(`match_lineups upsert: ${r.error.message}`);
    }
    return out({ok:errors.length===0,user_id:user.data.user.id,events_requested:(matches.data||[]).length,events_fetched:fetched,events_with_lineup:eventsWithLineup,lineup_rows_saved:rows.length,errors});
  }catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
