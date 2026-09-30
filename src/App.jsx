import React, { useEffect, useMemo, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

const TZ = 'America/Bogota'
const formatDate = (value, time = false) => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CO', time ? { hour: '2-digit', minute: '2-digit', timeZone: TZ } : { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).format(d)
}
function Stat({ icon, label, value, sub, cls }) { return <div className={'stat ' + cls}><div className="icon">{icon}</div><div><small>{label}</small><strong>{value}</strong><em>{sub}</em></div></div> }
function Bar({ label, value }) { return <div className="barrow"><span>{label}<b>{value}%</b></span><i><u style={{ width: value + '%' }} /></i></div> }

export default function App() {
  const [session, setSession] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [leagues, setLeagues] = useState([]), [teams, setTeams] = useState([]), [matches, setMatches] = useState([])
  const [predictions, setPredictions] = useState([]), [odds, setOdds] = useState([]), [statsCount, setStatsCount] = useState(0)
  const [market, setMarket] = useState('Todos'), [league, setLeague] = useState(''), [min, setMin] = useState(70)
  const [loading, setLoading] = useState(true), [syncing, setSyncing] = useState(false), [syncMessage, setSyncMessage] = useState(''), [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) { setLoading(false); setError('Supabase no está configurado.'); return undefined }
    let active = true
    supabase.auth.getSession().then(({ data, error: e }) => { if (!active) return; if (e) setError(e.message); setSession(data?.session || null) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { if (active) setSession(next) })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  useEffect(() => { if (session) loadDashboard() }, [session])

  async function loadDashboard() {
    if (!supabase) return
    setLoading(true); setError('')
    try {
      const [lr, mr, tr, pr, or, sr] = await Promise.all([
        supabase.from('leagues').select('id,name,country').order('name'),
        supabase.from('matches').select('id,league_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score,external_id').order('kickoff_at', { ascending: false }).limit(2000),
        supabase.from('teams').select('id,name').limit(2000),
        supabase.from('predictions').select('id,match_id,market_id,selection,probability,fair_odd,confidence,model_version,generated_at').order('generated_at', { ascending: false }).limit(5000),
        supabase.from('odds').select('id,match_id,market_id,bookmaker,selection,line,odd,observed_at').order('observed_at', { ascending: false }).limit(5000),
        supabase.from('match_stats').select('id', { count: 'exact', head: true })
      ])
      if (lr.error) throw lr.error; if (mr.error) throw mr.error; if (tr.error) throw tr.error
      if (pr.error) throw pr.error; if (or.error) throw or.error; if (sr.error) throw sr.error
      setLeagues(lr.data || []); setMatches(mr.data || []); setTeams(tr.data || [])
      setPredictions(pr.data || []); setOdds(or.data || []); setStatsCount(sr.count || 0)
    } catch (e) { setError(e?.message || 'No se pudieron cargar los datos.') } finally { setLoading(false) }
  }

  async function syncData() {
    if (!supabase || syncing) return
    setSyncing(true); setSyncMessage('Sincronizando TheSportsDB v2: ligas, equipos y próximos partidos…'); setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('thesportsdb-sync', { body: { action: 'sync_all' } })
      if (fnError) throw fnError
      if (data?.ok === false) throw new Error(data?.error || 'La sincronización terminó con errores.')
      const results = Array.isArray(data?.results) ? data.results : []
      const leaguesOk = results.filter(x => !x.error).length
      const count = results.reduce((n, x) => n + Number(x.matches || x.events || 0), 0)
      setSyncMessage(`TheSportsDB v2: ${leaguesOk}/${results.length} ligas procesadas · ${count} partidos recibidos.`)
      await loadDashboard()
    } catch (e) { setError(e?.message || 'No se pudo ejecutar la sincronización TheSportsDB.'); setSyncMessage('') }
    finally { setSyncing(false) }
  }

  const leagueMap = useMemo(() => new Map(leagues.map(x => [String(x.id), x.name])), [leagues])
  const teamMap = useMemo(() => new Map(teams.map(x => [String(x.id), x.name])), [teams])
  const filtered = matches.filter(x => !league || String(x.league_id) === String(league))
  const upcoming = filtered.filter(x => { const d = new Date(x.kickoff_at); return !Number.isNaN(d.getTime()) && d > new Date() }).sort((a,b) => new Date(a.kickoff_at)-new Date(b.kickoff_at))
  const finished = filtered.filter(x => x.home_score != null && x.away_score != null)
  const live = filtered.filter(x => ['LIVE','1H','2H','HT','IN PLAY'].includes(String(x.status || '').toUpperCase())).length
  const eligiblePredictions = predictions.filter(x => Number(x.probability) >= min && Number(x.probability) <= 100)
  const accaOdds = odds.filter(x => Number(x.odd) >= 1.30 && Number(x.odd) <= 2.20)

  const nav = [
    ['dashboard','⌂ Dashboard'], ['matches','⚽ Partidos'], ['predictions','◈ Predicciones'], ['acca','▦ ACCA Builder'], ['stats','◒ Estadísticas'], ['history','◷ Historial']
  ]

  function renderMatches(list = filtered) {
    return list.slice(0, 100).map(x => <div className="match" key={x.id}>
      <div><b>{formatDate(x.kickoff_at)}</b><small>{formatDate(x.kickoff_at, true)}</small></div>
      <strong>{teamMap.get(String(x.home_team_id)) || 'Equipo #' + x.home_team_id}<span>{x.home_score != null ? `${x.home_score}–${x.away_score}` : 'vs'}</span>{teamMap.get(String(x.away_team_id)) || 'Equipo #' + x.away_team_id}</strong>
      <label>{leagueMap.get(String(x.league_id)) || 'Liga'}</label><em>{x.home_score != null ? 'Finalizado' : 'Próximo'}</em><button onClick={() => setPage('predictions')}>→</button>
    </div>)
  }

  function renderPage() {
    if (page === 'matches') return <div className="panel"><div className="title"><div><h3>Partidos</h3><p>{upcoming.length} próximos · {finished.length} finalizados</p></div><button onClick={syncData} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar ligas'}</button></div><div className="filters"><select value={league} onChange={e => setLeague(e.target.value)}><option value="">Todas las ligas</option>{leagues.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>{upcoming.length ? renderMatches(upcoming) : <div className="empty">No hay partidos futuros cargados. Pulsa “Sincronizar ligas”.</div>}</div>
    if (page === 'predictions') return <div className="panel"><div className="title"><div><h3>Predicciones</h3><p>Datos reales de la tabla predictions</p></div></div>{predictions.length ? predictions.slice(0,100).map(p => <div className="match" key={p.id}><div><b>{Number(p.probability).toFixed(1)}%</b><small>{p.model_version}</small></div><strong>{teamMap.get(String(matches.find(m => m.id === p.match_id)?.home_team_id)) || 'Partido #' + p.match_id}<span>→</span>{p.selection}</strong><label>Fair {p.fair_odd ? Number(p.fair_odd).toFixed(2) : '—'}</label><em>{p.confidence ? Number(p.confidence).toFixed(0) + '% conf.' : 'Sin confianza'}</em></div>) : <div className="empty">Todavía no hay predicciones. Primero necesitamos estadísticas históricas suficientes para calcularlas.</div>}</div>
    if (page === 'acca') return <div className="panel"><div className="title"><div><h3>ACCA Builder</h3><p>Filtro configurado: probabilidad ≥ {min}% · cuota 1.30–2.20 · total 5–200</p></div></div>{eligiblePredictions.length && accaOdds.length ? <div className="empty">Hay {eligiblePredictions.length} predicciones y {accaOdds.length} cuotas dentro de los filtros. El generador de combinaciones se puede activar en la siguiente fase.</div> : <div className="empty">No puedo generar todavía una ACCA real: hay {predictions.length} predicciones y {odds.length} cuotas almacenadas. No se deben inventar probabilidades ni cuotas. Primero sincronizaremos estadísticas y la fuente de cuotas.</div>}<div className="note">Una ACCA real requiere predicción respaldada por datos y una cuota real para cada selección.</div></div>
    if (page === 'stats') return <div className="panel"><div className="title"><div><h3>Estadísticas</h3><p>Datos almacenados en match_stats</p></div></div><div className="stats"><Stat icon="◆" label="REGISTROS" value={statsCount} sub="match_stats" cls="o"/><Stat icon="◈" label="PREDICCIONES" value={predictions.length} sub="generadas" cls="c"/><Stat icon="◎" label="CUOTAS" value={odds.length} sub="observadas" cls="p"/></div></div>
    if (page === 'history') return <div className="panel"><div className="title"><div><h3>Historial</h3><p>Partidos finalizados almacenados</p></div></div>{renderMatches(finished)}</div>
    return <Dashboard />
  }

  function Dashboard() { return <>
    <div className="hero"><div><label>SMART FOOTBALL ANALYTICS</label><h2>Construye ACCAs con<br/><i>probabilidad y valor.</i></h2><p>Centro de control para analizar partidos, mercados y oportunidades.</p></div><strong>⚽</strong></div>
    <div className="stats"><Stat icon="⚽" label="PARTIDOS" value={loading ? '—' : filtered.length} sub={upcoming.length + ' próximos'} cls="p"/><Stat icon="◉" label="LIGAS" value={loading ? '—' : leagues.length} sub="Configuradas" cls="c"/><Stat icon="◆" label="FINALIZADOS" value={loading ? '—' : finished.length} sub="Con marcador" cls="o"/><Stat icon="⚡" label="EN VIVO" value={live} sub="Estado actual" cls="g"/></div>
    <div className="grid"><div className="panel"><div className="title"><div><h3>{upcoming.length ? 'Próximos partidos' : 'Partidos disponibles'}</h3><p>America/Bogota · Supabase · TheSportsDB v2</p></div><div><button onClick={loadDashboard}>Actualizar</button>{' '}<button onClick={syncData} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar TheSportsDB'}</button></div></div><div className="filters"><select value={league} onChange={e => setLeague(e.target.value)}><option value="">Todas las ligas</option>{leagues.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><select value={market} onChange={e => setMarket(e.target.value)}><option>Todos</option><option>1X2</option><option>BTTS</option><option>Over/Under</option><option>Corners</option><option>Cards</option><option>Shots</option></select><label>Prob. mínima <input type="number" value={min} min="50" max="99" onChange={e => setMin(Number(e.target.value) || 70)}/>%</label></div>{upcoming.length ? renderMatches(upcoming.slice(0,8)) : finished.slice(0,8).map(x => <div className="match" key={x.id}><div><b>{formatDate(x.kickoff_at)}</b><small>Finalizado</small></div><strong>{teamMap.get(String(x.home_team_id)) || 'Equipo #' + x.home_team_id}<span>{x.home_score}–{x.away_score}</span>{teamMap.get(String(x.away_team_id)) || 'Equipo #' + x.away_team_id}</strong><label>{leagueMap.get(String(x.league_id)) || 'Liga'}</label><em>Histórico</em><button onClick={() => setPage('history')}>→</button></div>)}{!loading && !upcoming.length && <div className="empty">No hay partidos futuros. Pulsa “Sincronizar TheSportsDB” para descargar partidos de las ligas configuradas.</div>}</div><div className="panel health"><div className="title"><div><h3>Salud del motor</h3><p>Estado real de los módulos</p></div><mark>LIVE</mark></div><Bar label="Base de datos" value={100}/><Bar label="Equipos y ligas" value={100}/><Bar label="Estadísticas" value={statsCount ? 100 : 0}/><Bar label="Predicciones" value={predictions.length ? 100 : 0}/><Bar label="Cuotas" value={odds.length ? 100 : 0}/><div className="note">No se muestran probabilidades ni cuotas ficticias.</div></div></div>
    <div className="bottom"><div className="panel acca"><label>ACCA ENGINE</label><h3>Generador</h3><p>Probabilidad mínima <b>{min}%</b> · cuota individual <b>1.30–2.20</b> · cuota total <b>5–200</b></p><button onClick={() => setPage('acca')}>ABRIR ACCA BUILDER →</button></div><div className="panel sources"><h3>Fuentes</h3><div><span>TheSportsDB v2</span><span>API-Football</span><span>Sportmonks</span><span>Football-data</span></div><small>TheSportsDB v2 está activa para partidos. La fuente de cuotas todavía debe conectarse antes de producir una ACCA real.</small></div></div>
  </> }

  if (!supabase) return <main className="config-error"><section className="card"><h1>ACCA Generator 4</h1><h2>Configuración pendiente</h2><p>{error}</p></section></main>
  if (!session) return <main><Auth onAuthenticated={setSession} /></main>
  return <div className="shell"><aside><div className="brand"><b>A</b><div>ACCA<span>GENERATOR 4</span></div></div><nav>{nav.map(([key,label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</nav><div className="sidebottom"><p>● Motor online<small>v0.4</small></p><button onClick={() => supabase.auth.signOut()}>↪ Cerrar sesión</button></div></aside><section className="page"><header><div><small>CONTROL CENTER</small><h1>{nav.find(x => x[0] === page)?.[1].replace(/^[^ ]+ /,'') || 'Dashboard'}</h1></div><div className="headright">● Bogotá · GMT-5<span>{session.user.email}</span><button onClick={loadDashboard}>↻</button></div></header>{error && <div className="alert">⚠ {error}</div>}{syncMessage && <div className="alert">⚡ {syncMessage}</div>}{renderPage()}</section></div>
}
