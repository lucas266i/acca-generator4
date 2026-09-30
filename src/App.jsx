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
  const [session, setSession] = useState(null), [leagues, setLeagues] = useState([]), [teams, setTeams] = useState([]), [matches, setMatches] = useState([])
  const [market, setMarket] = useState('Todos'), [league, setLeague] = useState(''), [min, setMin] = useState(70)
  const [loading, setLoading] = useState(true), [syncing, setSyncing] = useState(false), [syncMessage, setSyncMessage] = useState(''), [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) { setLoading(false); setError('Supabase no está configurado. Añade VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en GitHub Actions.'); return undefined }
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
      const [lr, mr, tr] = await Promise.all([
        supabase.from('leagues').select('id,name,country').order('name'),
        supabase.from('matches').select('id,league_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score').order('kickoff_at', { ascending: false }).limit(1000),
        supabase.from('teams').select('id,name').limit(1000)
      ])
      if (lr.error) throw lr.error; if (mr.error) throw mr.error; if (tr.error) throw tr.error
      setLeagues(lr.data || []); setMatches(mr.data || []); setTeams(tr.data || [])
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
      const matches = results.reduce((n, x) => n + Number(x.matches || 0), 0)
      setSyncMessage(`TheSportsDB v2: ${leaguesOk}/${results.length} ligas procesadas · ${matches} partidos actualizados.`)
      await loadDashboard()
    } catch (e) {
      setError(e?.message || 'No se pudo ejecutar la sincronización TheSportsDB.')
      setSyncMessage('')
    } finally { setSyncing(false) }
  }

  const leagueMap = useMemo(() => new Map(leagues.map(x => [String(x.id), x.name])), [leagues])
  const teamMap = useMemo(() => new Map(teams.map(x => [String(x.id), x.name])), [teams])
  const filtered = matches.filter(x => !league || String(x.league_id) === String(league))
  const upcoming = filtered.filter(x => { const d = new Date(x.kickoff_at); return !Number.isNaN(d.getTime()) && d > new Date() })
  const finished = filtered.filter(x => x.home_score != null && x.away_score != null)
  const live = filtered.filter(x => ['LIVE', '1H', '2H', 'HT'].includes(String(x.status || '').toUpperCase())).length
  const latestHistorical = finished.slice(0, 8)

  if (!supabase) return <main className="config-error"><section className="card"><h1>ACCA Generator 4</h1><h2>Configuración pendiente</h2><p>{error}</p><ol><li>GitHub → Settings → Secrets and variables → Actions.</li><li>Crea <code>VITE_SUPABASE_URL</code>.</li><li>Crea <code>VITE_SUPABASE_ANON_KEY</code>.</li><li>Ejecuta de nuevo el workflow de GitHub Pages.</li></ol></section></main>
  if (!session) return <main><Auth onAuthenticated={setSession} /></main>

  return <div className="shell">
    <aside><div className="brand"><b>A</b><div>ACCA<span>GENERATOR 4</span></div></div><nav><button className="active">⌂ Dashboard</button><button>⚽ Partidos</button><button>◈ Predicciones</button><button>▦ ACCA Builder</button><button>◒ Estadísticas</button><button>◷ Historial</button></nav><div className="sidebottom"><p>● Motor online<small>v0.3</small></p><button onClick={() => supabase.auth.signOut()}>↪ Cerrar sesión</button></div></aside>
    <section className="page">
      <header><div><small>CONTROL CENTER</small><h1>Dashboard</h1></div><div className="headright">● Bogotá · GMT-5<span>{session.user.email}</span><button onClick={loadDashboard}>↻</button></div></header>
      {error && <div className="alert">⚠ {error}</div>}{syncMessage && <div className="alert">⚡ {syncMessage}</div>}
      <div className="hero"><div><label>SMART FOOTBALL ANALYTICS</label><h2>Construye ACCAs con<br/><i>probabilidad y valor.</i></h2><p>Centro de control para analizar partidos, mercados y oportunidades.</p></div><strong>⚽</strong></div>
      <div className="stats"><Stat icon="⚽" label="PARTIDOS" value={loading ? '—' : filtered.length} sub={upcoming.length + ' próximos'} cls="p"/><Stat icon="◉" label="LIGAS" value={loading ? '—' : leagues.length} sub="Configuradas" cls="c"/><Stat icon="◆" label="FINALIZADOS" value={loading ? '—' : finished.length} sub="Con marcador" cls="o"/><Stat icon="⚡" label="EN VIVO" value={live} sub="Estado actual" cls="g"/></div>
      <div className="grid">
        <div className="panel">
          <div className="title"><div><h3>{upcoming.length ? 'Próximos partidos' : 'Partidos disponibles'}</h3><p>America/Bogota · Datos reales de Supabase · Fuente: TheSportsDB v2</p></div><div><button onClick={loadDashboard}>Actualizar</button>{' '}<button onClick={syncData} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar TheSportsDB'}</button></div></div>
          <div className="filters"><select value={league} onChange={e => setLeague(e.target.value)}><option value="">Todas las ligas</option>{leagues.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><select value={market} onChange={e => setMarket(e.target.value)}><option>Todos</option><option>1X2</option><option>BTTS</option><option>Over/Under</option><option>Corners</option><option>Cards</option><option>Shots</option></select><label>Prob. mínima <input type="number" value={min} min="50" max="99" onChange={e => setMin(Number(e.target.value) || 70)}/>%</label></div>
          {upcoming.length > 0 ? upcoming.slice(0, 8).map(x => <div className="match" key={x.id}><div><b>{formatDate(x.kickoff_at)}</b><small>{formatDate(x.kickoff_at, true)}</small></div><strong>{teamMap.get(String(x.home_team_id)) || 'Equipo #' + x.home_team_id}<span>vs</span>{teamMap.get(String(x.away_team_id)) || 'Equipo #' + x.away_team_id}</strong><label>{leagueMap.get(String(x.league_id)) || 'Liga'}</label><em>Sin predicción</em><button>→</button></div>) : latestHistorical.map(x => <div className="match" key={x.id}><div><b>{formatDate(x.kickoff_at)}</b><small>Finalizado</small></div><strong>{teamMap.get(String(x.home_team_id)) || 'Equipo #' + x.home_team_id}<span>{x.home_score}–{x.away_score}</span>{teamMap.get(String(x.away_team_id)) || 'Equipo #' + x.away_team_id}</strong><label>{leagueMap.get(String(x.league_id)) || 'Liga'}</label><em>Histórico</em><button>→</button></div>)}
          {!loading && !upcoming.length && !latestHistorical.length && <div className="empty">No hay partidos disponibles para el filtro seleccionado.</div>}{!loading && !upcoming.length && latestHistorical.length > 0 && <div className="empty">No hay partidos futuros en la base de datos. Pulsa “Sincronizar TheSportsDB” para actualizar los próximos partidos.</div>}
        </div>
        <div className="panel health"><div className="title"><div><h3>Salud del motor</h3><p>Estado real de los módulos</p></div><mark>LIVE</mark></div><Bar label="Base de datos" value={100}/><Bar label="Equipos y ligas" value={100}/><Bar label="Estadísticas" value={0}/><Bar label="Predicciones" value={0}/><Bar label="Cuotas" value={0}/><div className="note">⚠ Datos de partidos sincronizados desde TheSportsDB v2. Estadísticas, cuotas y predicciones se conectarán en las siguientes fases.</div></div>
      </div>
      <div className="bottom"><div className="panel acca"><label>ACCA ENGINE</label><h3>Generador preparado</h3><p>Objetivos configurados: probabilidad mínima <b>{min}%</b> · cuota individual <b>1.30–2.20</b> · cuota total <b>5–200</b></p><button>ABRIR ACCA BUILDER →</button></div><div className="panel sources"><h3>Fuentes de datos</h3><div><span>TheSportsDB v2</span><span>API-Football</span><span>Sportmonks</span><span>Football-data</span></div><small>TheSportsDB v2 es la fuente de sincronización activa del dashboard. Las demás quedan preparadas para fases posteriores.</small></div></div>
    </section>
  </div>
}
