
import React, { useCallback, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [teams, setTeams] = useState([])
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingLeague, setLoadingLeague] = useState(null)

  const authenticated = useCallback((s) => {
    setSession(s)
  }, [])

  async function logout() {
    if (supabase) {
      await supabase.auth.signOut()
    }

    setSession(null)
    setLeagues([])
    setTeams([])
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

    const { data, error } = await supabase.functions.invoke(
      'football-data',
      {
        body: {
          action: 'leagues',
          country: 'Colombia',
          season: '2024',
        },
      }
    )

    console.log('Respuesta leagues:', data)
    console.log('Error leagues:', error)

    if (error) {
      setApiError(error.message || 'Error consultando API-Football.')
      setLoading(false)
      return
    }

    if (!data?.ok) {
      setApiError(data?.error || 'API-Football devolvió un error.')
      setLoading(false)
      return
    }

    const results = data?.response?.response || []

    setLeagues(results)
    setLoading(false)
  }

  async function loadTeams(leagueId) {
    if (!supabase) {
      setApiError('Supabase no está configurado.')
      return
    }

    setLoadingLeague(leagueId)
    setApiError('')
    setTeams([])

    console.log('Cargando equipos:', leagueId)

    const { data, error } = await supabase.functions.invoke(
      'football-data',
      {
        body: {
          action: 'sync_teams',
          league: String(leagueId),
          season: '2024',
        },
      }
    )

    console.log('Respuesta sync_teams:', data)
    console.log('Error sync_teams:', error)

    if (error) {
      setApiError(error.message || 'Error cargando equipos.')
      setLoadingLeague(null)
      return
    }

    if (!data?.ok) {
      setApiError(data?.error || 'No se pudieron sincronizar los equipos.')
      setLoadingLeague(null)
      return
    }

    const resultTeams = data?.teams || []

    console.log('Equipos sincronizados:', resultTeams)

    setTeams(resultTeams)
    setLoadingLeague(null)
  }

  if (!session) {
    return (
      <main>
        <Auth onAuthenticated={authenticated} />
      </main>
    )
  }

  return (
    <main>
      <section className="card">
        <h1>Dashboard</h1>

        <p>Sesión activa para {session.user.email}</p>

        <button onClick={logout}>
          Cerrar sesión
        </button>

        <div className="placeholder">
          <h2>Datos de fútbol</h2>

          <p>
            Fuente: API-Football · Colombia · temporada 2024
          </p>

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
                {leagues.map((item) => (
                  <div
                    className="league-card"
                    key={item.league.id}
                  >
                    <img
                      src={item.league.logo}
                      alt=""
                      width="50"
                      height="50"
                    />

                    <div>
                      <strong>{item.league.name}</strong>

                      <p>
                        ID: {item.league.id} · Tipo: {item.league.type}
                      </p>

                      <button
                        onClick={() => loadTeams(item.league.id)}
                        disabled={loadingLeague === item.league.id}
                      >
                        {loadingLeague === item.league.id
                          ? 'Cargando equipos...'
                          : 'Cargar equipos'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {teams.length > 0 && (
          <div className="placeholder">
            <h2>{teams.length} equipos encontrados</h2>

            <p>
              Equipos sincronizados correctamente con Supabase.
            </p>

            <div className="team-list">
              {teams.map((team) => (
                <div
                  className="league-card"
                  key={team.id || team.external_id}
                >
                  <div>
                    <strong>{team.name}</strong>

                    <p>
                      ID Supabase: {team.id}
                    </p>

                    <p>
                      API-Football ID: {team.external_id}
                    </p>

                    <p>
                      País: {team.country || 'No disponible'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="placeholder">
          <h2>Motor ACCA</h2>

          <p>
            Próximo paso: obtener y guardar partidos,
            estadísticas y cuotas.
          </p>
        </div>
      </section>
    </main>
  )
}