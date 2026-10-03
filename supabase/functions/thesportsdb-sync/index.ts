import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://www.thesportsdb.com/api/v1/json";
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
const chunk=<T>(items:T[],size:number)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));

async function tsdb(path:string,key:string){
  const r=await fetch(`${API}/${encodeURIComponent(key)}/${path}`);
  const text=await r.text(); let data:any;
  try{data=JSON.parse(text)}catch{throw new Error(`TheSportsDB returned non-JSON (${r.status})`)}
  if(!r.ok)throw new Error(`TheSportsDB HTTP ${r.status}`);
  return data;
}
function isoDate(offset:number){const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(!['GET','POST'].includes(req.method))return out({ok:false,error:'Method not allowed'},405);
  const key=Deno.env.get('THESPORTSDB_API_KEY'),url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!key||!url||!service)return out({ok:false,error:'Missing server configuration'},500);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  let body:any={};try{if(req.method==='POST')body=await req.json()}catch{}
  const action=String(body.action??new URL(req.url).searchParams.get('action')??'sync_all');
  const requestedDays=Number(body.days??new URL(req.url).searchParams.get('days')??7);
  const daysCount=Math.max(1,Math.min(7,Number.isFinite(requestedDays)?Math.floor(requestedDays):7));
  if(action!=='sync_all')return out({ok:false,error:'Unknown action'},400);

  const errors:string[]=[];let eventsFetched=0,leaguesSaved=0,teamsSaved=0,matchesSaved=0;
  try{
    const days=await Promise.all(Array.from({length:daysCount},(_,i)=>{
      const date=isoDate(i);
      return tsdb(`eventsday.php?d=${date}&s=Soccer`,key)
        .then(data=>({date,events:Array.isArray(data?.events)?data.events:[]}))
        .catch(error=>({date,events:[],error}));
    }));

    const events:any[]=[];
    for(const day of days){
      if(day.error){errors.push(`${day.date}: ${day.error instanceof Error?day.error.message:String(day.error)}`);continue;}
      eventsFetched+=day.events.length;
      events.push(...day.events);
    }

    const valid=[...new Map(events.filter(e=>e?.idEvent&&e?.strHomeTeam&&e?.strAwayTeam&&e?.strLeague).map(e=>[String(e.idEvent),e])).values()];
    const uniqueLeagues=[...new Map(valid.map(e=>{
      const external_id=`tsdb:${String(e.idLeague??e.strLeague).trim()}`;
      return [external_id,{external_id,name:String(e.strLeague).trim(),country:e.strCountry?String(e.strCountry):null}];
    })).values()];

    for(const rows of chunk(uniqueLeagues,200)){
      const r=await db.from('leagues').upsert(rows,{onConflict:'external_id'}).select('id,external_id');
      if(r.error)throw new Error(`leagues upsert: ${r.error.message}`);
    }
    const leagueKeys=uniqueLeagues.map(x=>x.external_id);
    const leagueRows=leagueKeys.length?await db.from('leagues').select('id,external_id').in('external_id',leagueKeys):{data:[],error:null};
    if(leagueRows.error)throw new Error(`leagues lookup: ${leagueRows.error.message}`);
    const leagueMap=new Map((leagueRows.data||[]).map((x:any)=>[String(x.external_id),x.id]));
    leaguesSaved=uniqueLeagues.length;

    const teamRows=[...new Map(valid.flatMap(e=>{
      const leagueId=leagueMap.get(`tsdb:${String(e.idLeague??e.strLeague).trim()}`),country=e.strCountry?String(e.strCountry):null;
      const home={external_id:`tsdb:${String(e.idHomeTeam??e.strHomeTeam)}`,league_id:leagueId,name:String(e.strHomeTeam).trim(),short_name:null,country,is_active:true};
      const away={external_id:`tsdb:${String(e.idAwayTeam??e.strAwayTeam)}`,league_id:leagueId,name:String(e.strAwayTeam).trim(),short_name:null,country,is_active:true};
      return [[home.external_id,home],[away.external_id,away]] as any;
    })).values()].filter((x:any)=>x.league_id);

    for(const rows of chunk(teamRows,300)){
      const r=await db.from('teams').upsert(rows,{onConflict:'external_id'}).select('id,external_id');
      if(r.error)throw new Error(`teams upsert: ${r.error.message}`);
    }
    teamsSaved=teamRows.length;
    const teamKeys=teamRows.map((x:any)=>x.external_id);
    const teamDb=teamKeys.length?await db.from('teams').select('id,external_id').in('external_id',teamKeys):{data:[],error:null};
    if(teamDb.error)throw new Error(`teams lookup: ${teamDb.error.message}`);
    const teamMap=new Map((teamDb.data||[]).map((x:any)=>[String(x.external_id),x.id]));

    const matchRows=valid.map(e=>{
      const leagueId=leagueMap.get(`tsdb:${String(e.idLeague??e.strLeague).trim()}`);
      const homeId=teamMap.get(`tsdb:${String(e.idHomeTeam??e.strHomeTeam)}`);
      const awayId=teamMap.get(`tsdb:${String(e.idAwayTeam??e.strAwayTeam)}`);
      const dateTime=`${e.dateEvent}T${String(e.strTime??'00:00:00').slice(0,8)}Z`;
      const parsedDate=new Date(dateTime);
      const hs=e.intHomeScore!==null&&e.intHomeScore!==undefined&&e.intHomeScore!==''?Number(e.intHomeScore):null;
      const as=e.intAwayScore!==null&&e.intAwayScore!==undefined&&e.intAwayScore!==''?Number(e.intAwayScore):null;
      return {league_id:leagueId,home_team_id:homeId,away_team_id:awayId,kickoff_at:Number.isNaN(parsedDate.getTime())?new Date().toISOString():parsedDate.toISOString(),status:hs!==null&&as!==null?'FT':'NS',home_score:Number.isFinite(hs)?hs:null,away_score:Number.isFinite(as)?as:null,external_id:String(e.idEvent),season:String(e.strSeason??''),round:e.intRound?String(e.intRound):null};
    }).filter(x=>x.league_id&&x.home_team_id&&x.away_team_id);

    for(const rows of chunk(matchRows,300)){
      const r=await db.from('matches').upsert(rows,{onConflict:'external_id'});
      if(r.error)throw new Error(`matches upsert: ${r.error.message}`);
      matchesSaved+=rows.length;
    }

    return out({ok:errors.length===0,action,days:daysCount,events_fetched:eventsFetched,leagues_saved:leaguesSaved,teams_saved:teamsSaved,matches_saved:matchesSaved,errors});
  }catch(error){
    return out({ok:false,partial:true,action,days:daysCount,error:error instanceof Error?error.message:String(error),events_fetched:eventsFetched,leagues_saved:leaguesSaved,teams_saved:teamsSaved,matches_saved:matchesSaved,errors},200);
  }
});
