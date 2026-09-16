import React, { useCallback, useMemo, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

const TIMEZONE = 'America/Bogota'
const SEASONS = ['2024', '2025', '2026']

function formatDateTime(value) {
  if (!value) return 'Fecha no disponible'
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(value))
  } catch { return value }
}

function getStatusLabel(status) {
  const labels = {
    NS: 'Programado', TBD: 'Por confirmar', LIVE: 'En vivo', HT: 'Descanso',
    FT: 'Finalizado', AET: 'Finalizado AET', PEN: 'Finalizado por penaltis',
    PST: 'Pospuesto', CANC: 'Cancelado', ABD: 'Abandonado', '1H': '1.er tiempo', '2H': '2.º tiempo',
  }
  return labels[status] || status || 'Sin estado'
}

function isFutureMatch(match) {
  const d = new Date(match?.kickoff_at)
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now()
}

export default function App() {
  const [session, setSession] = useState(null)
  const [season, setSeason] = useState('2026')
  const [leagues, setLeagues] = useState([])
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [statsCount, setStatsCount] = useState(0)
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const authenticated = useCallback((s) => setSession(s), [])

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    setSession(null); setLeagues([]); setTeams([]); setMatches([]); setSelectedLeague(null)
  }

  async function invoke(body) {
    if (!supabase) throw new Error('Supabase no está configurado.')
    const { data, error } = await supabase.functions.invoke('football-data', { body })
    if (error) throw error
    if (!data?.ok) throw new Error(data?.error || data?.response?.errors?.plan || 'La operación falló.')
    return data
  }

  async function loadLeagues() {
    setBusy('leagues'); setApiError('')
    try {
      const data = await invoke({ action: 'leagues', country: 'Colombia', season })
      setLeagues(data?.response?.response || [])
      setTeams([]); setMatches([]); setSelectedLeague(null); setStatsCount(0)
    } catch (e) { setApiError(e?.message || 'Error consultando ligas.') }
    finally { setBusy('') }
  }

  async function loadTeams(leagueId) {
    setBusy(`teams-${leagueId}`); setApiError(''); setSelectedLeague(leagueId)
    try {
      const data = await invoke({ action: 'sync_teams', league: String(leagueId), season })
      setTeams(data?.teams || [])
    } catch (e) { setApiError(e?.message || 'Error sincronizando equipos.') }
    finally { setBusy('') }
  }

  async function loadMatches(leagueId) {
    setBusy(`matches-${leagueId}`); setApiError(''); setSelectedLeague(leagueId)
    try {
      const data = await invoke({ action: 'sync_fixtures', league: String(leagueId), season })
      const synced = Array.isArray(data?.matches) ? data.matches : []
      setMatches(synced)
      if (!synced.length) setApiError(data?.warning || 'No se encontraron partidos.')
    } catch (e) { setApiError(e?.message || 'Error sincronizando partidos.') }
    finally { setBusy('') }
  }

  async function loadStoredMatches(leagueId) {
    setBusy(`stored-${leagueId}`); setApiError(''); setSelectedLeague(leagueId)
    try {
      const { data, error } = await supabase.from('matches')
        .select('id,league_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score,external_id,season,round')
        .eq('league_id', leagueId).eq('season', season).order('kickoff_at', { ascending: true })
      if (error) throw error
      setMatches(data || [])
    } catch (e) { setApiError(e?.message || 'Error leyendo partidos guardados.') }
    finally { setBusy('') }
  }

  async function syncStatistics() {
    if (!matches.length) {
      setApiError('Primero sincroniza o carga partidos de una liga.')
      return
    }
    setBusy('stats'); setApiError('')
    try {
      const ids = matches.map(m => m.external_id).filter(Boolean)
      const data = await invoke({ action: 'sync_statistics', fixture_ids: ids })
      setStatsCount(data?.saved || 0)
    } catch (e) { setApiError(e?.message || 'Error sincronizando estadísticas.') }
    finally { setBusy('') }
  }

  const teamMap = useMemo(() => new Map(teams.map(t => [String(t.id), t.name])), [teams])
  const futureMatches = matches.filter(isFutureMatch)
  const selectedLeagueObject = leagues.find(x => String(x?.league?.id) === String(selectedLeague))

  if (!session) return <main><Auth onAuthenticated={authenticated} /></main>

  return (
    <main>
      <section className="card">
        <h1>ACCA Generator</h1>
        <p>Sesión activa: <strong>{session.user.email}</strong></p>
        <button onClick={logout}>Cerrar sesión</button>

        <div className="placeholder">
          <h2>Datos de fútbol</h2>
          <p>Fuente: API-Football · Colombia · Zona horaria: {TIMEZONE}</p>
          <label>
            Temporada:{' '}
            <select value={season} onChange={e => {
              setSeason(e.target.value); setLeagues([]); setTeams([]); setMatches([]); setStatsCount(0)
            }}>
              {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div style={{ marginTop: 12 }}>
            <button onClick={loadLeagues} disabled={!!busy}>
              {busy === 'leagues' ? 'Cargando...' : 'Cargar ligas Colombia'}
            </button>
          </div>
          {apiError && <div className="message"><strong>Error:</strong> {apiError}</div>}
        </div>

        {leagues.length > 0 && (
          <div className="placeholder">
            <h2>{leagues.length} ligas encontradas · temporada {season}</h2>
            <div className="league-list">
              {leagues.map(item => {
                const league = item?.league
                if (!league?.id) return null
                const id = league.id
                return (
                  <div className="league-card" key={id}>
                    <div>
                      <strong>{league.name}</strong>
                      <p>ID API-Football: {id}</p>
                      <button onClick={() => loadTeams(id)} disabled={!!busy}>
                        {busy === `teams-${id}` ? 'Sincronizando...' : 'Sincronizar equipos'}
                      </button>{' '}
                      <button onClick={() => loadMatches(id)} disabled={!!busy}>
                        {busy === `matches-${id}` ? 'Sincronizando...' : 'Sincronizar partidos'}
                      </button>{' '}
                      <button onClick={() => loadStoredMatches(id)} disabled={!!busy}>
                        {busy === `stored-${id}` ? 'Leyendo...' : 'Leer guardados'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {teams.length > 0 && (
          <div className="placeholder">
            <h2>{teams.length} equipos</h2>
            <div className="team-list">
              {teams.map(t => <div className="league-card" key={t.id || t.external_id}>
                <strong>{t.name}</strong><p>API-Football ID: {t.external_id}</p>
              </div>)}
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <div className="placeholder">
            <h2>Partidos · {selectedLeagueObject?.league?.name || `Liga ${selectedLeague}`}</h2>
            <p>Total: <strong>{matches.length}</strong> · Próximos: <strong>{futureMatches.length}</strong></p>
            <button onClick={syncStatistics} disabled={!!busy}>
              {busy === 'stats' ? 'Sincronizando estadísticas...' : 'Sincronizar estadísticas'}
            </button>
            {statsCount > 0 && <p>Estadísticas guardadas en esta operación: <strong>{statsCount}</strong></p>}
            <div className="league-list">
              {matches.map(m => (
                <div className="league-card" key={m.id || m.external_id}>
                  <strong>{teamMap.get(String(m.home_team_id)) || `Equipo #${m.home_team_id}`}</strong>
                  {' vs '}
                  <strong>{teamMap.get(String(m.away_team_id)) || `Equipo #${m.away_team_id}`}</strong>
                  <p>{formatDateTime(m.kickoff_at)} · {getStatusLabel(m.status)}</p>
                  <p>{m.round || 'Jornada no disponible'} · {m.home_score ?? '-'} - {m.away_score ?? '-'}</p>
                  <p>Fixture ID: {m.external_id}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="placeholder">
          <h2>Motor ACCA</h2>
          <p>Base de datos preparada para temporadas múltiples y estadísticas por equipo/partido.</p>
          <p>Próxima capa: forma, local/visitante, H2H, probabilidades y optimizador ACCA.</p>
        </div>
      </section>
    </main>
  )
}