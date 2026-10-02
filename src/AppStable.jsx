import React,{useCallback,useEffect,useMemo,useState} from 'react'
import Auth from './components/Auth'
import {supabase} from './lib/supabase'

const TZ='America/Bogota'
const norm=v=>String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_')
const fmt=(v,time=false)=>new Intl.DateTimeFormat('es-CO',time?{hour:'2-digit',minute:'2-digit',timeZone:TZ}:{day:'2-digit',month:'short',year:'numeric',timeZone:TZ}).format(new Date(v))
const pct=v=>`${(Number(v)*100).toFixed(1)}%`
const markets=[['all','Todos'],['1x2','1X2'],['btts','BTTS'],['over_1_5','Over 1.5'],['over_2_5','Over 2.5'],['corners','Corners'],['cards','Cards'],['shots','Shots'],['shots_on_target','Shots on Target'],['player_props','Props jugadores']]

export default function AppStable(){
 const[session,setSession]=useState(null),[ready,setReady]=useState(false)
 const[page,setPage]=useState('dashboard'),[leagues,setLeagues]=useState([]),[teams,setTeams]=useState([]),[matches,setMatches]=useState([]),[marketRows,setMarketRows]=useState([]),[predictions,setPredictions]=useState([]),[odds,setOdds]=useState([])
 const[range,setRange]=useState('next_7'),[league,setLeague]=useState(''),[market,setMarket]=useState('all'),[prob,setProb]=useState(70),[minOdd,setMinOdd]=useState(1.3),[maxOdd,setMaxOdd]=useState(2.1),[target,setTarget]=useState(5)
 const[selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[err,setErr]=useState('')

 const load=useCallback(async()=>{
  const [a,b,c,d,e,f]=await Promise.all([
   supabase.from('leagues').select('id,name,country').order('name'),
   supabase.from('teams').select('id,name').limit(5000),
   supabase.from('matches').select('id,league_id,home_team_id,away_team_id,kickoff_at,home_score,away_score,external_id,status').order('kickoff_at').limit(5000),
   supabase.from('markets').select('id,code,name,category').eq('is_active',true),
   supabase.from('predictions').select('id,match_id,market_id,selection,probability,fair_odd,confidence').order('generated_at',{ascending:false}).limit(20000),
   supabase.from('odds').select('id,match_id,market_id,bookmaker,selection,odd').order('observed_at',{ascending:false}).limit(30000)
  ])
  const bad=[a,b,c,d,e,f].find(x=>x.error)
  if(bad){setErr(bad.error.message);return false}
  setLeagues(a.data||[]);setTeams(b.data||[]);setMatches(c.data||[]);setMarketRows(d.data||[]);setPredictions(e.data||[]);setOdds(f.data||[])
  return true
 },[])

 useEffect(()=>{let live=true;supabase.auth.getSession().then(({data})=>{if(live){setSession(data?.session||null);setReady(true)}});const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>live&&setSession(s));return()=>{live=false;subscription.unsubscribe()}},[])
 useEffect(()=>{if(!session)return;load();const t=setInterval(load,60000);return()=>clearInterval(t)},[session,load])

 const lm=useMemo(()=>new Map(leagues.map(x=>[String(x.id),x])),[leagues])
 const tm=useMemo(()=>new Map(teams.map(x=>[String(x.id),x.name])),[teams])
 const mm=useMemo(()=>new Map(marketRows.map(x=>[String(x.id),x])),[marketRows])
 const mcode=id=>norm(mm.get(String(id))?.code||mm.get(String(id))?.name||'')
 const bounds=useMemo(()=>{const s=new Date();s.setHours(0,0,0,0);const e=new Date(s);if(range==='today')e.setDate(e.getDate()+1);else if(range==='tomorrow'){s.setDate(s.getDate()+1);e.setDate(e.getDate()+1)}else e.setDate(e.getDate()+Number(range.replace('next_',''))+1);return[s,e]},[range])
 const upcoming=useMemo(()=>{const now=Date.now();return matches.filter(m=>{const d=new Date(m.kickoff_at).getTime();return d>=bounds[0].getTime()&&d<bounds[1].getTime()&&d>now&&(!league||String(m.league_id)===String(league))}).sort((a,b)=>new Date(a.kickoff_at)-new Date(b.kickoff_at))},[matches,bounds,league])
 const filtered=useMemo(()=>{const now=Date.now();return predictions.filter(p=>{const m=matches.find(x=>String(x.id)===String(p.match_id));if(!m)return false;const d=new Date(m.kickoff_at).getTime();if(!(d>=bounds[0].getTime()&&d<bounds[1].getTime()&&d>now))return false;if(league&&String(m.league_id)!==String(league))return false;if(selected.length&&!selected.includes(String(m.id)))return false;return market==='all'||mcode(p.market_id)===market})},[predictions,matches,bounds,league,selected,market,mm])

 const candidates=useMemo(()=>{
  const best=new Map()
  for(const o of odds){const k=`${o.match_id}|${o.market_id}|${norm(o.selection)}`;if(!best.has(k)||Number(o.odd)>Number(best.get(k).odd))best.set(k,o)}
  return filtered.filter(p=>Number(p.probability)>=prob/100).map(p=>{
   const k=`${p.match_id}|${p.market_id}|${norm(p.selection)}`,live=best.get(k),fair=Number(p.fair_odd)
   const price=live&&Number(live.odd)>=minOdd&&Number(live.odd)<=maxOdd?live:(Number.isFinite(fair)&&fair>=minOdd&&fair<=maxOdd?{odd:fair,bookmaker:'MODEL_FAIR',selection:p.selection,match_id:p.match_id,market_id:p.market_id}:null)
   return price?{p,o:price}:null
  }).filter(Boolean).sort((a,b)=>Number(b.p.probability)-Number(a.p.probability))
 },[filtered,odds,prob,minOdd,maxOdd])

 const accas=useMemo(()=>{
  const out=[],lo=Math.max(5,target*.85),hi=Math.min(200,target*1.15)
  const walk=(start,picks,total,used)=>{
   if(picks.length>=2&&total>=lo&&total<=hi)out.push({picks:[...picks],total})
   if(picks.length>=12||total>=hi||out.length>=200)return
   for(let i=start;i<candidates.length&&out.length<200;i++){
    const r=candidates[i],id=String(r.p.match_id);if(used.has(id))continue
    const n=total*Number(r.o.odd);if(n>hi)continue
    used.add(id);picks.push(r);walk(i+1,picks,n,used);picks.pop();used.delete(id)
   }
  }
  walk(0,[],1,new Set())
  const seen=new Set()
  return out.sort((a,b)=>Math.abs(a.total-target)-Math.abs(b.total-target)).filter(a=>{const k=a.picks.map(x=>x.p.id).sort().join(',');if(seen.has(k))return false;seen.add(k);return true}).slice(0,10)
 },[candidates,target])

 const name=m=>`${tm.get(String(m?.home_team_id))||'Local'} vs ${tm.get(String(m?.away_team_id))||'Visitante'}`

 async function invokeAnalysis(ids){
  const unique=[...new Set(ids.map(String).filter(Boolean))]
  let ps=0,os=0
  for(let i=0;i<unique.length;i+=25){
   const batch=unique.slice(i,i+25)
   const r=await supabase.functions.invoke('thesportsdb-analysis',{body:{fixture_ids:batch}})
   if(r.error){const detail=r.data?.error||r.error.message||'Error de análisis';throw new Error(detail)}
   ps+=Number(r.data?.predictions_saved||0);os+=Number(r.data?.odds_saved||0)
   setMsg(`Analizando ${Math.min(i+batch.length,unique.length)}/${unique.length} · ${ps} predicciones · ${os} precios`)
  }
  await load();return{ps,os}
 }

 async function sync(){
  if(busy)return
  setBusy(true);setErr('');setMsg('Sincronizando TheSportsDB Premium…')
  try{
   const r=await supabase.functions.invoke('thesportsdb-sync-v2',{body:{action:'sync_all'}})
   if(r.error)throw new Error(r.data?.error||r.error.message||'Falló la sincronización')
   await load()
   const partial=r.data?.partial?' · sincronización parcial':''
   setMsg(`Sincronización terminada${partial} · ${r.data?.matches_saved??0} partidos actualizados.`)
  }catch(e){setErr(e?.message||String(e));setMsg('')}finally{setBusy(false)}
 }

 async function choose(m){
  const id=String(m.id)
  if(selected.includes(id)){setSelected(x=>x.filter(v=>v!==id));return}
  const ext=String(m.external_id||'')
  if(!ext){setErr('Este partido no tiene external_id de TheSportsDB.');return}
  setSelected(x=>[...x,id]);setBusy(true);setErr('');setMsg(`Analizando ${name(m)}…`)
  try{const a=await invokeAnalysis([ext]);setMsg(a.ps?`${name(m)} listo: ${a.ps} predicciones y ${a.os} precios.`:'Partido procesado, pero no generó predicciones suficientes.')}catch(e){setErr(e?.message||String(e));setSelected(x=>x.filter(v=>v!==id));setMsg('')}finally{setBusy(false)}
 }

 if(!ready)return <div className="app"><main className="content"><h2>Cargando…</h2></main></div>
 if(!session)return <Auth/>
 const nav=[['dashboard','⌂ Dashboard'],['matches','⚽ Partidos'],['predictions','◈ Predicciones'],['acca','▦ ACCA Builder'],['stats','◒ Estadísticas'],['history','◷ Historial']]
 const Filters=()=> <section className="panel filter-panel"><div className="title"><div><h3>Filtros del generador</h3><p>Selecciona partidos, analiza y genera combinaciones automáticamente.</p></div><button onClick={sync} disabled={busy}>{busy?'Procesando…':'Sincronizar + analizar'}</button></div><div className="filter-grid"><label>Fecha<select value={range} onChange={e=>setRange(e.target.value)}><option value="today">Hoy</option><option value="tomorrow">Mañana</option>{[3,4,5,6,7].map(n=><option key={n} value={`next_${n}`}>Próximos {n} días</option>)}</select></label><label>Liga<select value={league} onChange={e=>setLeague(e.target.value)}><option value="">Todas</option>{leagues.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>Mercado<select value={market} onChange={e=>setMarket(e.target.value)}>{markets.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label><label>Prob. mínima (%)<input type="number" value={prob} min="1" max="99" onChange={e=>setProb(Number(e.target.value)||70)}/></label><label>Cuota mínima<input type="number" value={minOdd} step=".01" onChange={e=>setMinOdd(Number(e.target.value)||1.3)}/></label><label>Cuota máxima<input type="number" value={maxOdd} step=".01" onChange={e=>setMaxOdd(Number(e.target.value)||2.1)}/></label><label>ACCA objetivo<select value={target} onChange={e=>setTarget(Number(e.target.value))}>{Array.from({length:196},(_,i)=><option key={i+5} value={i+5}>ACCA ≈ {i+5}</option>)}</select></label></div><div className="filter-summary">Objetivo: <b>{target}</b> · rango {Math.max(5,target*.85).toFixed(1)}–{Math.min(200,target*1.15).toFixed(1)} · cuota/selección {minOdd.toFixed(2)}–{maxOdd.toFixed(2)} · prob. mínima {prob}% · seleccionados {selected.length}</div></section>
 const MatchList=()=> <section className="panel"><div className="title"><div><h3>Próximos partidos</h3><p>{upcoming.length} partidos disponibles. Seleccionar analiza el partido y lo incorpora al ACCA Builder.</p></div></div>{upcoming.slice(0,300).map(m=><article className="match" key={m.id}><div><b>{name(m)}</b><small>{lm.get(String(m.league_id))?.name||'—'} · {fmt(m.kickoff_at,true)} · {fmt(m.kickoff_at)}</small></div><button onClick={()=>choose(m)} disabled={busy}>{selected.includes(String(m.id))?'✓ Analizado':'Seleccionar'}</button></article>)}{!upcoming.length&&<div className="empty">No hay partidos para este rango.</div>}</section>
 const Builder=()=> <section className="panel"><div className="title"><div><h3>ACCA Builder</h3><p>{candidates.length} candidatos válidos · objetivo {target}.</p></div><button onClick={()=>setPage('matches')}>Elegir partidos</button></div>{accas.length?accas.map((a,i)=><article className="acca" key={i}><b>ACCA #{i+1} · cuota {a.total.toFixed(2)} · {a.picks.length} selecciones</b>{a.picks.map((x,j)=>{const m=matches.find(z=>String(z.id)===String(x.p.match_id));return <div key={j}>{name(m)} · {x.p.selection||x.p.p.selection} · {pct(x.p.probability)} · {Number(x.o.odd).toFixed(2)} · {x.o.bookmaker||'MODEL_FAIR'}</div>})}</article>):<div className="empty">No hay ACCAs con los filtros actuales. Analiza al menos 4 partidos si buscas una cuota cercana a 5 con cuotas individuales de 1.30–2.10.</div>}</section>
 const body=page==='matches'?<><Filters/><MatchList/></>:page==='predictions'?<><Filters/><section className="panel"><h3>Predicciones</h3>{filtered.slice(0,300).map(p=>{const m=matches.find(x=>String(x.id)===String(p.match_id));return <article className="match" key={p.id}><div><b>{name(m)}</b><small>{mm.get(String(p.market_id))?.name||mcode(p.market_id)} · {p.selection} · {pct(p.probability)}</small></div><strong>{Number(p.fair_odd||0).toFixed(2)}</strong></article>})}</section></>:page==='acca'?<><Filters/><Builder/></>:page==='stats'?<><Filters/><section className="panel"><h3>Estadísticas</h3><p>Partidos: {matches.length} · Ligas: {leagues.length} · Predicciones: {predictions.length} · Precios: {odds.length}</p></section></>:page==='history'?<><Filters/><section className="panel"><h3>Historial</h3>{matches.filter(m=>m.home_score!=null&&m.away_score!=null).slice(-200).reverse().map(m=><article className="match" key={m.id}><div><b>{name(m)}</b><small>{lm.get(String(m.league_id))?.name||'—'}</small></div><strong>{m.home_score}–{m.away_score}</strong></article>)}</section></>:<><Filters/><MatchList/><Builder/></>
 return <div className="app"><aside className="sidebar"><div className="brand">⚽ <b>ACCAGENERATOR</b><small>4</small></div><nav>{nav.map(([id,label])=><button className={page===id?'active':''} key={id} onClick={()=>setPage(id)}>{label}</button>)}</nav><button className="logout" onClick={()=>supabase.auth.signOut()}>↪ Cerrar sesión</button></aside><main className="content"><div className="topline"><span>CONTROL CENTER</span><span>Bogotá · GMT-5 · {session.user.email}</span></div>{err&&<div className="alert">⚠ {err}</div>}{msg&&<div className="notice">{msg}</div>}<section className="hero"><div><label>SMART FOOTBALL ANALYTICS</label><h2>Construye ACCAs con <i>datos verificables.</i></h2><p>TheSportsDB Premium · partidos, ligas, equipos, jugadores y estadísticas · modelo propio para predicciones y precios.</p></div></section><div className="stats"><div className="stat">PARTIDOS<strong>{upcoming.length}</strong><small>próximos</small></div><div className="stat">LIGAS<strong>{leagues.length}</strong><small>configuradas</small></div><div className="stat">FINALIZADOS<strong>{matches.filter(m=>m.home_score!=null&&m.away_score!=null).length}</strong><small>con marcador</small></div><div className="stat">PREDICCIONES<strong>{predictions.length}</strong><small>modelo</small></div><div className="stat">PRECIOS<strong>{odds.length}</strong><small>MODEL_FAIR</small></div></div>{body}</main></div>
}
