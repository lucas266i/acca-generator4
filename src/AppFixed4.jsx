import React,{useCallback,useEffect,useMemo,useState} from 'react'
import Auth from './components/Auth'
import {supabase} from './lib/supabase'

const TZ='America/Bogota'
const TOP5=['English Premier League','Spanish La Liga','German Bundesliga','Italian Serie A','French Ligue 1']
const EUROPE=['England','Spain','Germany','Italy','France','Netherlands','Belgium','Portugal','Scotland','Turkey','Denmark','Sweden','Poland','Austria','Croatia','Switzerland','Greece','Norway','Czech Republic','Czechia']
const SOUTH=['Argentina','Brazil','Colombia','Chile','Uruguay','Paraguay','Ecuador','Peru','Bolivia','Venezuela']
const norm=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_')
const pct=v=>`${(Number(v)*100).toFixed(1)}%`
const fmt=(v,time=false)=>new Intl.DateTimeFormat('es-CO',time?{hour:'2-digit',minute:'2-digit',timeZone:TZ}:{day:'2-digit',month:'short',year:'numeric',timeZone:TZ}).format(new Date(v))
const MARKET_OPTIONS=[['1x2','1X2'],['btts','BTTS'],['over_1_5','Over 1.5'],['over_2_5','Over 2.5'],['corners','Corners'],['cards','Cards'],['shots','Shots'],['shots_on_target','Shots on Target']]
const PROP_OPTIONS=[['shots','Tiros de jugadores'],['shots_on_target','Tiros a puerta'],['assists','Asistencias'],['goals','Goles'],['cards','Tarjetas'],['fouls','Faltas cometidas']]

export default function AppFixed4(){
 const[session,setSession]=useState(null),[ready,setReady]=useState(false),[page,setPage]=useState('dashboard')
 const[leagues,setLeagues]=useState([]),[teams,setTeams]=useState([]),[matches,setMatches]=useState([]),[markets,setMarkets]=useState([]),[predictions,setPredictions]=useState([]),[odds,setOdds]=useState([]),[statsCount,setStatsCount]=useState(0)
 const[dateRange,setDateRange]=useState('next_7'),[leagueGroup,setLeagueGroup]=useState('all'),[league,setLeague]=useState('')
 const[marketMode,setMarketMode]=useState('all'),[selectedMarkets,setSelectedMarkets]=useState([]),[propMode,setPropMode]=useState('all'),[selectedProps,setSelectedProps]=useState([])
 const[minProb,setMinProb]=useState(70),[minOdd,setMinOdd]=useState(1.3),[maxOdd,setMaxOdd]=useState(2.2)
 const[targetMode,setTargetMode]=useState('preset'),[target,setTarget]=useState(5),[manualTarget,setManualTarget]=useState(15)
 const[countMode,setCountMode]=useState('auto'),[pickCount,setPickCount]=useState(5),[dayPickCount,setDayPickCount]=useState(5),[accaMode,setAccaMode]=useState('normal'),[maxPerMatch,setMaxPerMatch]=useState(1)
 const[syncing,setSyncing]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')

 const load=useCallback(async()=>{
  if(!supabase)return
  const[a,b,c,m,p,o,s]=await Promise.all([
   supabase.from('leagues').select('id,name,country').order('name'),
   supabase.from('matches').select('id,league_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score,external_id').order('kickoff_at',{ascending:true}).limit(5000),
   supabase.from('teams').select('id,name').limit(5000),
   supabase.from('markets').select('id,code,name,category,is_active').eq('is_active',true).order('id'),
   supabase.from('predictions').select('id,match_id,market_id,selection,probability,fair_odd,confidence,model_version,generated_at').order('generated_at',{ascending:false}).limit(20000),
   supabase.from('odds').select('id,match_id,market_id,bookmaker,selection,line,odd,observed_at').order('observed_at',{ascending:false}).limit(30000),
   supabase.from('match_stats').select('id',{count:'exact',head:true})
  ])
  const bad=[a,b,c,m,p,o,s].find(x=>x.error)
  if(bad){setError(bad.error.message);return false}
  setLeagues(a.data||[]);setMatches(b.data||[]);setTeams(c.data||[]);setMarkets(m.data||[]);setPredictions(p.data||[]);setOdds(o.data||[]);setStatsCount(s.count||0)
  return true
 },[])

 useEffect(()=>{
  if(!supabase){setReady(true);return}
  let on=true
  supabase.auth.getSession().then(({data})=>{if(on){setSession(data?.session||null);setReady(true)}})
  const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>on&&setSession(s))
  return()=>{on=false;subscription.unsubscribe()}
 },[])

 useEffect(()=>{if(session)load()},[session,load])

 const leagueMap=useMemo(()=>new Map(leagues.map(x=>[String(x.id),x])),[leagues])
 const teamMap=useMemo(()=>new Map(teams.map(x=>[String(x.id),x.name])),[teams])
 const marketMap=useMemo(()=>new Map(markets.map(x=>[String(x.id),x])),[markets])
 const now=Date.now()
 const bounds=useMemo(()=>{
  const s=new Date();s.setHours(0,0,0,0)
  const e=new Date(s)
  if(dateRange==='today')e.setDate(e.getDate()+1)
  else if(dateRange==='tomorrow'){s.setDate(s.getDate()+1);e.setDate(e.getDate()+1)}
  else if(dateRange.startsWith('next_'))e.setDate(e.getDate()+Number(dateRange.split('_')[1]))
  else e.setFullYear(e.getFullYear()+1)
  return{s,e}
 },[dateRange])

 const inGroup=useCallback(m=>{
  if(league&&String(m.league_id)!==String(league))return false
  if(leagueGroup==='all')return true
  const l=leagueMap.get(String(m.league_id)),name=l?.name||'',country=l?.country||''
  if(leagueGroup==='top5')return TOP5.some(x=>norm(x)===norm(name))
  if(leagueGroup==='europe')return EUROPE.some(x=>norm(country).includes(norm(x)))||TOP5.some(x=>norm(x)===norm(name))
  if(leagueGroup==='south')return SOUTH.some(x=>norm(country).includes(norm(x)))
  return true
 },[league,leagueGroup,leagueMap])

 const upcoming=useMemo(()=>matches.filter(m=>{
  const d=Date.parse(m.kickoff_at)
  return d>=bounds.s.getTime()&&d<bounds.e.getTime()&&d>now&&inGroup(m)
 }).sort((a,b)=>Date.parse(a.kickoff_at)-Date.parse(b.kickoff_at)),[matches,bounds,inGroup,now])

 const marketCode=id=>norm(marketMap.get(String(id))?.code||marketMap.get(String(id))?.name||'')
 const propType=p=>{
  const s=norm(p.selection)
  if(s.includes('shot_on_target')||s.includes('on_target')||s.includes('tiro_a_puerta'))return'shots_on_target'
  if(s.includes('assist')||s.includes('asistencia'))return'assists'
  if(s.includes('goal')||s.includes('gol'))return'goals'
  if(s.includes('card')||s.includes('tarjeta'))return'cards'
  if(s.includes('foul')||s.includes('falta'))return'fouls'
  if(s.includes('shot')||s.includes('tiro'))return'shots'
  return'other'
 }
 const isPlayerProp=p=>{
  const c=marketCode(p.market_id),m=marketMap.get(String(p.market_id))
  return c.includes('player')||c.includes('prop')||norm(m?.category).includes('player')||['shots','shots_on_target','assists','goals','cards','fouls'].includes(propType(p))
 }
 const marketOk=p=>{
  if(isPlayerProp(p)){
   if(marketMode==='all')return propMode==='all'||selectedProps.includes(propType(p))
   return selectedMarkets.includes('player_props')&&(propMode==='all'||selectedProps.includes(propType(p)))
  }
  return marketMode==='all'||selectedMarkets.includes(marketCode(p.market_id))
 }
 const filtered=useMemo(()=>predictions.filter(p=>{
  const m=matches.find(x=>String(x.id)===String(p.match_id));if(!m)return false
  const d=Date.parse(m.kickoff_at)
  return d>=bounds.s.getTime()&&d<bounds.e.getTime()&&d>now&&inGroup(m)&&marketOk(p)
 }),[predictions,matches,bounds,inGroup,marketMode,selectedMarkets,propMode,selectedProps,marketMap,now])

 const candidates=useMemo(()=>{
  const best=new Map()
  for(const o of odds){
   const odd=Number(o.odd);if(!Number.isFinite(odd)||odd<=1)continue
   const k=`${o.match_id}|${o.market_id}|${norm(o.selection)}`,prev=best.get(k)
   if(!prev||odd>Number(prev.odd))best.set(k,o)
  }
  return filtered.map(p=>{
   const key=`${p.match_id}|${p.market_id}|${norm(p.selection)}`,o=best.get(key),fair=Number(p.fair_odd)
   const fairCandidate=Number.isFinite(fair)&&fair>1?{id:`fair-${p.id}`,match_id:p.match_id,market_id:p.market_id,selection:p.selection,odd:fair,bookmaker:'MODEL_FAIR'}:null
   const price=[o,fairCandidate].filter(Boolean).filter(x=>{const v=Number(x.odd);return Number.isFinite(v)&&v>=minOdd&&v<=maxOdd}).sort((a,b)=>Number(b.odd)-Number(a.odd))[0]
   return price?{p,o:price}:null
  }).filter(Boolean).filter(x=>Number(x.p.probability)>=minProb/100).sort((a,b)=>Number(b.p.probability)-Number(a.p.probability))
 },[filtered,odds,minProb,minOdd,maxOdd])

 const desired=targetMode==='manual'?Math.min(200,Math.max(5,Number(manualTarget)||5)):target
 const fixedCount=accaMode==='day'?dayPickCount:pickCount
 const tolerance=Math.max(.5,desired*.15)
 const minTarget=Math.max(5,desired-tolerance),maxTarget=Math.min(200,desired+tolerance)

 const accas=useMemo(()=>{
  const wanted=countMode==='manual'?fixedCount:null
  const beamWidth=600
  let states=[{picks:[],total:1,used:new Map()}],results=[]
  const maxSteps=Math.min(wanted||Math.max(2,Math.ceil(Math.log(Math.max(maxTarget,5))/Math.log(Math.max(minOdd,1.01)))+2),20)
  for(let step=0;step<maxSteps;step++){
   const next=[]
   for(const st of states){
    for(const r of candidates){
     const mid=String(r.p.match_id),used=st.used.get(mid)||0
     if(used>=maxPerMatch||st.picks.some(x=>x.p.id===r.p.id))continue
     const total=st.total*Number(r.o.odd)
     if(!Number.isFinite(total)||total>maxTarget)continue
     const used2=new Map(st.used);used2.set(mid,used+1)
     next.push({picks:[...st.picks,r],total,used:used2})
    }
   }
   next.sort((a,b)=>{
    const ca=!wanted?Math.abs(a.picks.length-(Math.round(Math.log(desired)/Math.log(Math.max(minOdd,1.01))))) : Math.abs(a.picks.length-wanted)
    const cb=!wanted?Math.abs(b.picks.length-(Math.round(Math.log(desired)/Math.log(Math.max(minOdd,1.01))))) : Math.abs(b.picks.length-wanted)
    return ca-cb||Math.abs(a.total-desired)-Math.abs(b.total-desired)
   })
   states=next.slice(0,beamWidth)
   for(const st of states){
    const okCount=!wanted||st.picks.length===wanted
    if(st.picks.length>=2&&okCount&&st.total>=minTarget&&st.total<=maxTarget)results.push({picks:st.picks,total:st.total,matches:new Set(st.picks.map(x=>String(x.p.match_id))).size})
   }
   if(!states.length)break
   if(results.length>1000)break
  }
  const seen=new Set(),unique=[]
  results.sort((a,b)=>Math.abs(a.total-desired)-Math.abs(b.total-desired))
  for(const r of results){
   const key=r.picks.map(x=>x.p.id).sort().join(',')
   if(seen.has(key))continue
   seen.add(key);unique.push(r)
   if(unique.length>=10)break
  }
  return unique
 },[candidates,countMode,fixedCount,desired,minTarget,maxTarget,maxPerMatch,minOdd])

 const toggle=(v,setter,arr)=>setter(arr.includes(v)?arr.filter(x=>x!==v):[...arr,v])
 const analyzeIds=async ids=>{
  const unique=[...new Set(ids.map(String).filter(Boolean))],batchSize=50
  let predictionsSaved=0,oddsSaved=0,processed=0
  for(let i=0;i<unique.length;i+=batchSize){
   const batch=unique.slice(i,i+batchSize)
   const a=await supabase.functions.invoke('thesportsdb-analysis',{body:{fixture_ids:batch}})
   if(a.error)throw new Error(a.data?.error||a.error.message||'Edge Function de análisis falló')
   if(a.data?.ok===false)throw new Error(a.data.error||'El análisis no fue aceptado')
   predictionsSaved+=Number(a.data?.predictions_saved||0)
   oddsSaved+=Number(a.data?.odds_saved||0)
   processed+=Number(a.data?.resolved||batch.length)
   setMessage(`Analizando ${Math.min(i+batch.length,unique.length)}/${unique.length} · ${predictionsSaved} predicciones · ${oddsSaved} precios`)
  }
  await load();return{predictionsSaved,oddsSaved,processed}
 }

 const sync=async()=>{
  if(syncing||!supabase)return
  setSyncing(true);setError('');setMessage('Sincronizando TheSportsDB Premium…')
  try{
   const days=dateRange==='today'?1:dateRange==='tomorrow'?1:dateRange==='all'?7:Math.min(7,Number(dateRange.split('_')[1])||7)
   const r=await supabase.functions.invoke('thesportsdb-sync',{body:{action:'sync_all',days}})
   if(r.error)throw new Error(r.data?.error||r.error.message||'Falló la sincronización')
   if(r.data?.ok===false&&!r.data?.partial)throw new Error(r.data?.error||'La sincronización no fue aceptada')
   await load()
   setMessage(`Sincronización terminada · ${r.data?.events_fetched??0} eventos consultados · ${r.data?.matches_saved??0} partidos procesados${r.data?.partial?' · algunos días tuvieron errores':''}.`)
  }catch(e){setError(e?.message||String(e));setMessage('')}finally{setSyncing(false)}
 }
 const analyzeUpcoming=async()=>{
  if(syncing)return
  const ids=upcoming.map(m=>m.external_id).filter(Boolean)
  if(!ids.length){setError('No hay partidos con external_id para analizar.');return}
  setSyncing(true);setError('');setMessage(`Analizando automáticamente ${ids.length} partidos…`)
  try{const a=await analyzeIds(ids);setMessage(`Análisis terminado · ${a.processed} partidos · ${a.predictionsSaved} predicciones · ${a.oddsSaved} precios MODEL_FAIR.`)}catch(e){setError(e?.message||String(e));setMessage('')}finally{setSyncing(false)}
 }

 if(!ready)return <div className="app"><main className="content"><h2>Cargando…</h2></main></div>
 if(!session)return <Auth/>

 const dateLabel={today:'Hoy',tomorrow:'Mañana',next_3:'Próximos 3 días',next_4:'Próximos 4 días',next_5:'Próximos 5 días',next_6:'Próximos 6 días',next_7:'Próximos 7 días',all:'Todos los próximos'}[dateRange]
 const nav=[['dashboard','⌂ Dashboard'],['matches','⚽ Partidos'],['predictions','◈ Predicciones'],['acca','▦ ACCA Builder'],['stats','◒ Estadísticas'],['history','◷ Historial']]
 const matchName=m=>`${teamMap.get(String(m?.home_team_id))||'Local'} vs ${teamMap.get(String(m?.away_team_id))||'Visitante'}`

 const FilterPanel=()=> <section className="panel filter-panel"><div className="title"><div><h3>Filtros del generador</h3><p>El motor selecciona automáticamente los partidos; no tienes que marcarlos uno por uno.</p></div><div><button onClick={sync} disabled={syncing}>{syncing?'Sincronizando…':'Sincronizar'}</button><button onClick={analyzeUpcoming} disabled={syncing||!upcoming.length}>{syncing?'Procesando…':'Analizar partidos'}</button></div></div><div className="filter-grid">
  <label>Fecha<select value={dateRange} onChange={e=>setDateRange(e.target.value)}><option value="today">Hoy</option><option value="tomorrow">Mañana</option>{[3,4,5,6,7].map(n=><option key={n} value={`next_${n}`}>Próximos {n} días</option>)}<option value="all">Todos los próximos</option></select></label>
  <label>Grupo de ligas<select value={leagueGroup} onChange={e=>{setLeagueGroup(e.target.value);setLeague('')}}><option value="all">Todas las ligas</option><option value="top5">Top 5 ligas</option><option value="europe">Ligas europeas</option><option value="south">Ligas sudamericanas</option></select></label>
  <label>Liga individual<select value={league} onChange={e=>{setLeague(e.target.value);setLeagueGroup('all')}}><option value="">Cualquiera</option>{leagues.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
  <label>Probabilidad mínima (%)<input type="number" min="1" max="99" value={minProb} onChange={e=>setMinProb(Math.min(99,Math.max(1,Number(e.target.value)||70)))}/></label>
  <label>Cuota individual mínima<input type="number" min="1.2" max="2.5" step=".01" value={minOdd} onChange={e=>setMinOdd(Math.min(2.5,Math.max(1.2,Number(e.target.value)||1.2)))}/></label>
  <label>Cuota individual máxima<input type="number" min="1.2" max="2.5" step=".01" value={maxOdd} onChange={e=>setMaxOdd(Math.min(2.5,Math.max(1.2,Number(e.target.value)||2.2)))}/></label>
  <label>Cuota total<select value={targetMode==='manual'?'manual':target} onChange={e=>e.target.value==='manual'?setTargetMode('manual'):(setTargetMode('preset'),setTarget(Number(e.target.value)))}>{Array.from({length:196},(_,i)=><option key={i+5} value={i+5}>ACCA ≈ {i+5}</option>)}<option value="manual">Cuota aproximada manual</option></select></label>
  {targetMode==='manual'&&<label>Objetivo manual (5–200)<input type="number" min="5" max="200" step=".1" value={manualTarget} onChange={e=>setManualTarget(e.target.value)}/></label>}
  <label>Modo de selecciones<select value={countMode} onChange={e=>setCountMode(e.target.value)}><option value="auto">Automático según cuota total</option><option value="manual">Número de partidos</option></select></label>
  {countMode==='manual'&&<label>Número de partidos<select value={accaMode==='day'?dayPickCount:pickCount} onChange={e=>accaMode==='day'?setDayPickCount(Number(e.target.value)):setPickCount(Number(e.target.value))}>{Array.from({length:19},(_,i)=><option key={i+2} value={i+2}>{i+2} partidos</option>)}</select></label>}
  <label>Máx. selecciones por partido<select value={maxPerMatch} onChange={e=>setMaxPerMatch(Number(e.target.value))}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
  <label>Tipo de ACCA<select value={accaMode} onChange={e=>setAccaMode(e.target.value)}><option value="normal">ACCA normal</option><option value="day">ACCA del día (5–10)</option></select></label>
 </div>
 <div className="filter-block"><b>Mercados</b><div className="chips"><button className={marketMode==='all'?'chip active':'chip'} onClick={()=>{setMarketMode('all');setSelectedMarkets([])}}>Cualquiera / todos</button>{MARKET_OPTIONS.map(([v,t])=><button key={v} className={marketMode==='selected'&&selectedMarkets.includes(v)?'chip active':'chip'} onClick={()=>{setMarketMode('selected');toggle(v,setSelectedMarkets,selectedMarkets)}}>{t}</button>)}<button className={marketMode==='selected'&&selectedMarkets.includes('player_props')?'chip active':'chip'} onClick={()=>{setMarketMode('selected');toggle('player_props',setSelectedMarkets,selectedMarkets)}}>Props de jugadores</button></div></div>
 <div className="filter-block"><b>Props de jugadores</b><div className="chips"><button className={propMode==='all'?'chip active':'chip'} onClick={()=>{setPropMode('all');setSelectedProps([])}}>Cualquier prop</button>{PROP_OPTIONS.map(([v,t])=><button key={v} className={propMode==='selected'&&selectedProps.includes(v)?'chip active':'chip'} onClick={()=>{setPropMode('selected');toggle(v,setSelectedProps,selectedProps)}}>{t}</button>)}</div></div>
 <div className="filter-summary"><b>Objetivo:</b> ACCA ≈ {desired.toFixed(2)} · rango {minTarget.toFixed(1)}–{maxTarget.toFixed(1)} · <b>cuota/selección:</b> {minOdd.toFixed(2)}–{maxOdd.toFixed(2)} · <b>prob. mínima:</b> {minProb}% · <b>partidos:</b> {countMode==='auto'?'automáticos':fixedCount}</div>
 </section>

 const Matches=()=> <section className="panel"><div className="title"><div><h3>Próximos partidos</h3><p>{upcoming.length} disponibles. El motor los selecciona automáticamente.</p></div></div>{upcoming.slice(0,500).map(m=><article className="match" key={m.id}><div><b>{matchName(m)}</b><small>{leagueMap.get(String(m.league_id))?.name||'—'} · {fmt(m.kickoff_at,true)} · {fmt(m.kickoff_at)}</small></div></article>)}{!upcoming.length&&<div className="empty">No hay partidos para estos filtros.</div>}</section>

 const Builder=()=> <section className="panel"><div className="title"><div><h3>ACCA Builder</h3><p>{candidates.length} candidatos válidos · el motor elige automáticamente los partidos.</p></div></div>{accas.length?accas.map((a,i)=><article className="acca" key={i}><b>ACCA #{i+1} · cuota {a.total.toFixed(2)} · {a.picks.length} selecciones · {a.matches} partidos</b>{a.picks.map((x,j)=>{const m=matches.find(z=>String(z.id)===String(x.p.match_id));return <div key={j}>{matchName(m)} · {marketMap.get(String(x.p.market_id))?.name||marketMap.get(String(x.p.market_id))?.code||'Mercado'} · {x.p.selection} · prob. {pct(x.p.probability)} · cuota {Number(x.o.odd).toFixed(2)} · {x.o.bookmaker||'MODEL_FAIR'}</div>})}</article>):<div className="empty"><b>No se encontró una ACCA con los filtros actuales.</b><br/>Candidatos válidos: {candidates.length}. Pulsa «Analizar partidos» para generar las predicciones de los partidos disponibles.</div>}</section>

 let body=page==='matches'?<><FilterPanel/><Matches/></>:page==='acca'?<><FilterPanel/><Builder/></>:page==='predictions'?<><FilterPanel/><section className="panel"><div className="title"><h3>Predicciones</h3><span>{filtered.length} válidas</span></div>{filtered.length?filtered.slice(0,500).map(p=>{const m=matches.find(x=>String(x.id)===String(p.match_id));return <article className="match" key={p.id}><div><b>{matchName(m)}</b><small>{marketMap.get(String(p.market_id))?.name||marketMap.get(String(p.market_id))?.code} · {p.selection} · {pct(p.probability)}</small></div><strong>{Number(p.fair_odd||0).toFixed(2)}</strong></article>}):<div className="empty">No hay predicciones para estos filtros.</div>}</section></>:page==='stats'?<><FilterPanel/><section className="panel"><h3>Estadísticas</h3><p>match_stats: <b>{statsCount}</b> · Predicciones: <b>{predictions.length}</b> · MODEL_FAIR: <b>{odds.length}</b> · Candidatos: <b>{candidates.length}</b>.</p></section></>:page==='history'?<><FilterPanel/><section className="panel"><h3>Historial</h3>{matches.filter(m=>m.home_score!=null&&m.away_score!=null).slice(-200).reverse().map(m=><article className="match" key={m.id}><div><b>{matchName(m)}</b><small>{leagueMap.get(String(m.league_id))?.name||'—'} · {fmt(m.kickoff_at)}</small></div><strong>{m.home_score}–{m.away_score}</strong></article>)}</section></>:<><FilterPanel/><Builder/></>

 return <div className="app"><aside className="sidebar"><div className="brand">⚽ <b>ACCAGENERATOR</b><small>4</small></div><nav>{nav.map(([id,label])=><button className={page===id?'active':''} onClick={()=>setPage(id)} key={id}>{label}</button>)}</nav><button className="logout" onClick={()=>supabase.auth.signOut()}>↪ Cerrar sesión</button></aside><main className="content"><div className="topline"><span>CONTROL CENTER</span><span>Bogotá · GMT-5 · {session.user?.email||''}</span></div>{error&&<div className="alert">⚠ {error}</div>}{message&&<div className="notice">{message}</div>}<div className="stats"><div className="stat">PARTIDOS<strong>{upcoming.length}</strong><small>{dateLabel}</small></div><div className="stat">LIGAS<strong>{leagues.length}</strong><small>configuradas</small></div><div className="stat">FINALIZADOS<strong>{matches.filter(m=>m.home_score!=null&&m.away_score!=null).length}</strong><small>con marcador</small></div><div className="stat">PREDICCIONES<strong>{predictions.length}</strong><small>modelo propio</small></div><div className="stat">PRECIOS<strong>{odds.length}</strong><small>MODEL_FAIR</small></div></div><section className="hero"><div><label>SMART FOOTBALL ANALYTICS</label><h2>Construye ACCAs con <i>datos verificables</i>.</h2><p>TheSportsDB Premium · partidos, ligas, equipos, jugadores y estadísticas · modelo propio para predicciones y precios.</p></div></section>{body}</main></div>
}
