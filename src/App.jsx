import React, { useCallback, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

const SEASON = '2024'
const TIMEZONE = 'America/Bogota'

function formatDateTime(value) {
  if (!value) return 'Fecha no disponible'
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function getStatusLabel(status) {
  const labels = {
    NS: 'Programado',
    TBD: 'Por confirmar',
    LIVE: 'En vivo',
    HT: 'Descanso',
    FT: 'Finalizado',
    AET: 'Finalizado AET',
    PEN: 'Finalizado por penaltis',
    PST: 'Pospuesto',
    CANC: 'Cancelado',
    ABD: 'Abandonado',
    '1H': '1.er tiempo',
    '2H': '2.º tiempo',
  }
  return labels[status] || status || 'Sin estado'
}

function isFutureMatch(match) {
  if (!match?.kickoff_at) return false
  const kickoff = new Date(match.kickoff_at)
  if (Number.isNaN(kickoff.getTime())) return false
  return kickoff.getTime() > Date.now()
}

export default function App() {
  const [session, setSession] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingLeague, setLoadingLeague] = useState(null)
  const [loadingMatches, setLoadingMatches] = useState(false)

  const authenticated = useCallback((s) => {
    setSession(s)
  }, [])

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    setSession(null)
    setLeagues([])
    setTeams([])
    setMatches([])
    setSelectedLeague(null)
    setApiError('')
  }

  async function loadLeagues() {
    if (!supabase) {
      setApiError('Supabase no está configurado.')
      return
    }

    setLoading(true)
    setApiError('')
    setLeagues([])
    setTeams([])
    setMatches([])
    setSelectedLeague(null)

    try {
      const { data, error } = await supabase.functions.invoke('football-data', {
        body: {
          action: 'leagues',
          country: 'Colombia',
          season: SEASON,
        },
      })

      if (error) {
        setApiError(error.message || 'Error consultando API-Football.')
        return
      }

      if (!data?.ok) {
        setApiError(
          data?.response?.errors?.plan ||
          data?.error ||
          'API-Football devolvió un error.'
        )
        return
      }

      const results = data?.response?.response || []
      setLeagues(results)

      if (results.length === 0) {
        setApiError('API-Football no devolvió ligas para Colombia.')
      }
    } catch (error) {
      setApiError(error?.message || 'Ocurrió un error consultando las ligas.')
    } finally {
      setLoading(false)
    }
  }

  async function loadTeams(leagueId) {
    if (!supabase) {
      setApiError('Supabase no está configurado.')
      return
    }

    setLoadingLeague(leagueId)
    setApiError('')
    setTeams([])
    setMatches([])
    setSelectedLeague(leagueId)

    try {
      const { data, error } = await supabase.functions.invoke('football-data', {
        body: {
          action: 'sync_teams',
          league: String(leagueId),
          season: SEASON,
        },
      })

      if (error) {
        setApiError(error.message || 'Error cargando equipos.')
        return
      }

      if (!data?.ok) {
        setApiError(data?.error || 'No se pudieron sincronizar los equipos.')
        return
      }

      setTeams(data?.teams || [])
    } catch (error) {
      setApiError(error?.message || 'Ocurrió un error cargando los equipos.')
    } finally {
      setLoadingLeague(null)
    }
  }

  async function loadMatches(leagueId) {
    if (!supabase) {
      setApiError('Supabase no está configurado.')
      return
    }

    setLoadingMatches(true)
    setApiError('')
    setMatches([])
    setSelectedLeague(leagueId)

    try {
      const { data, error } = await supabase.functions.invoke('football-data', {
        body: {
          action: 'sync_fixtures',
          league: String(leagueId),
          season: SEASON,
        },
      })

      if (error) {
        setApiError(error.message || 'Error sincronizando los partidos.')
        return
      }

      if (!data?.ok) {
        setApiError(data?.error || 'No se pudieron sincronizar los partidos.')
        return
      }

      const syncedMatches = Array.isArray(data?.matches) ? data.matches : []
      const teamMap = new Map()

      teams.forEach((team) => {
        if (team?.id != null) teamMap.set(String(team.id), team)
      })

      const normalizedMatches = syncedMatches.map((match) => ({
        ...match,
        home_team_name:
          teamMap.get(String(match.home_team_id))?.name ||
          `Equipo #${match.home_team_id}`,
        away_team_name:
          teamMap.get(String(match.away_team_id))?.name ||
          `Equipo #${match.away_team_id}`,
      }))

      normalizedMatches.sort(
        (a, b) =>
          new Date(a.kickoff_at).getTime() -
          new Date(b.kickoff_at).getTime()
      )

      setMatches(normalizedMatches)

      if (normalizedMatches.length === 0) {
        setApiError(data?.warning || 'No se encontraron partidos para esta liga.')
      }
    } catch (error) {
      setApiError(error?.message || 'Ocurrió un error cargando los partidos.')
    } finally {
      setLoadingMatches(false)
    }
  }

  async function loadStoredMatches(leagueId) {
    if (!supabase) {
      setApiError('Supabase no está configurado.')
      return
    }

    setLoadingMatches(true)
    setApiError('')
    setSelectedLeague(leagueId)

    try {
      const { data, error } = await supabase
        .from('matches')
        .select(`
          id,
          league_id,
          home_team_id,
          away_team_id,
          kickoff_at,
          status,
          home_score,
          away_score,
          external_id,
          season,
          round
        `)
        .eq('league_id', leagueId)
        .eq('season', SEASON)
        .order('kickoff_at', { ascending: true })

      if (error) {
        setApiError(error.message || 'No se pudieron leer los partidos guardados.')
        return
      }

      const teamMap = new Map()
      teams.forEach((team) => {
        if (team?.id != null) teamMap.set(String(team.id), team)
      })

      const normalizedMatches = (data || []).map((match) => ({
        ...match,
        home_team_name:
          teamMap.get(String(match.home_team_id))?.name ||
          `Equipo #${match.home_team_id}`,
        away_team_name:
          teamMap.get(String(match.away_team_id))?.name ||
          `Equipo #${match.away_team_id}`,
      }))

      setMatches(normalizedMatches)
    } catch (error) {
      setApiError(error?.message || 'Error leyendo los partidos almacenados.')
    } finally {
      setLoadingMatches(false)
    }
  }

  if (!session) {
    return (
      <main>
        <Auth onAuthenticated={authenticated} />
      </main>
    )
  }

  const futureMatches = matches.filter(isFutureMatch)

  const selectedLeagueObject = leagues.find(
    (item) => String(item?.league?.id) === String(selectedLeague)
  )

  return (
    <main>
      <section className="card">
        <h1>Dashboard</h1>

        <p>
          Sesión activa para <strong>{session.user.email}</strong>
        </p>

        <button onClick={logout}>Cerrar sesión</button>

        <div className="placeholder">
          <h2>Datos de fútbol</h2>

          <p>
            Fuente: API-Football · Colombia · temporada {SEASON}
          </p>

          <p>Zona horaria: {TIMEZONE}</p>

          <button onClick={loadLeagues} disabled={loading}>
            {loading ? 'Cargando ligas...' : 'Cargar ligas Colombia'}
          </button>

          {apiError && (
            <div className="message">
              <strong>Error:</strong> {apiError}
            </div>
          )}

          {leagues.length > 0 && (
            <div>
              <h3>{leagues.length} ligas encontradas</h3>

              <div className="league-list">
                {leagues.map((item) => {
                  const league = item?.league
                  if (!league?.id) return null

                  const isSelected =
                    String(selectedLeague) === String(league.id)

                  return (
                    <div className="league-card" key={league.id}>
                      {league.logo && (
                        <img
                          src={league.logo}
                          alt=""
                          width="50"
                          height="50"
                        />
                      )}

                      <div>
                        <strong>{league.name}</strong>

                        <p>ID API-Football: {league.id}</p>
                        <p>Tipo: {league.type || 'No disponible'}</p>

                        <div>
                          <button
                            onClick={() => loadTeams(league.id)}
                            disabled={loadingLeague === league.id}
                          >
                            {loadingLeague === league.id
                              ? 'Cargando equipos...'
                              : 'Cargar equipos'}
                          </button>

                          <button
                            onClick={() => loadMatches(league.id)}
                            disabled={loadingMatches}
                          >
                            {loadingMatches && isSelected
                              ? 'Cargando partidos...'
                              : 'Cargar partidos'}
                          </button>

                          <button
                            onClick={() => loadStoredMatches(league.id)}
                            disabled={loadingMatches}
                          >
                            Leer partidos guardados
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {teams.length > 0 && (
          <div className="placeholder">
            <h2>{teams.length} equipos encontrados</h2>

            <p>Equipos sincronizados correctamente con Supabase.</p>

            <div className="team-list">
              {teams.map((team) => (
                <div
                  className="league-card"
                  key={team.id || team.external_id}
                >
                  <div>
                    <strong>{team.name}</strong>
                    <p>ID Supabase: {team.id}</p>
                    <p>API-Football ID: {team.external_id}</p>
                    <p>País: {team.country || 'No disponible'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <div className="placeholder">
            <h2>Partidos</h2>

            {selectedLeagueObject?.league?.name && (
              <p>
                Liga: <strong>{selectedLeagueObject.league.name}</strong>
              </p>
            )}

            <div
              style={{
                display: 'flex',
                gap: '20px',
                flexWrap: 'wrap',
                marginBottom: '20px',
              }}
            >
              <div>
                <strong>Total</strong>
                <p>{matches.length}</p>
              </div>

              <div>
                <strong>Próximos</strong>
                <p>{futureMatches.length}</p>
              </div>
            </div>

            <div className="league-list">
              {matches.map((match) => (
                <div
                  className="league-card"
                  key={match.id || match.external_id}
                >
                  <div>
                    <strong>{match.home_team_name}</strong>

                    <p
                      style={{
                        margin: '6px 0',
                        fontWeight: 'bold',
                      }}
                    >
                      vs
                    </p>

                    <strong>{match.away_team_name}</strong>

                    <p>Fecha: {formatDateTime(match.kickoff_at)}</p>
                    <p>Estado: {getStatusLabel(match.status)}</p>
                    <p>Jornada: {match.round || 'No disponible'}</p>

                    {match.home_score !== null &&
                      match.home_score !== undefined &&
                      match.away_score !== null &&
                      match.away_score !== undefined && (
                        <p>
                          Marcador:{' '}
                          <strong>
                            {match.home_score} - {match.away_score}
                          </strong>
                        </p>
                      )}

                    <p>ID API-Football: {match.external_id}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="placeholder">
          <h2>Motor ACCA</h2>

          <p>
            El motor utilizará los partidos almacenados como base para el análisis.
          </p>

          <div>
            <h3>Próxima arquitectura</h3>
            <p>1. Partidos</p>
            <p>2. Estadísticas</p>
            <p>3. Mercados</p>
            <p>4. Probabilidad por selección</p>
            <p>5. Cuota aproximada</p>
            <p>6. Filtro de probabilidad mínima</p>
            <p>7. Optimizador ACCA</p>
          </div>

          <p>
            Estado actual: <strong>Partidos implementados</strong>
          </p>
        </div>
      </section>
    </main>
  )
}
