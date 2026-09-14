import React, { useCallback, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)

  const authenticated = useCallback((s) => setSession(s), [])

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    setSession(null)
    setLeagues([])
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

    const { data, error } = await supabase.functions.invoke('football-data', {
      body: {
        action: 'leagues',
        country: 'Colombia',
        season: '2024',
      },
    })

    if (error) {
      setApiError(error.message || 'No se pudo consultar API-Football.')
      setLoading(false)
      return
    }

    if (!data?.ok) {
      setApiError(
        data?.response?.errors?.plan ||
          data?.error ||
          'API-Football devolvió un error.'
      )
      setLoading(false)
      return
    }

    const results = data?.response?.response || []

    setLeagues(results)
    setLoading(false)
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

        <button onClick={logout}>Cerrar sesión</button>

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
                  <div className="league-card" key={item.league.id}>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="placeholder">
          <h2>Motor ACCA</h2>

          <p>
            Próximo: guardar las ligas seleccionadas en Supabase y después
            obtener equipos y partidos.
          </p>
        </div>
      </section>
    </main>
  )
}
