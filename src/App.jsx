import React, { useEffect, useMemo, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

const TZ = 'America/Bogota'

function Stat({ icon, label, value, sub, cls }) {
  return (
    <div className={'stat ' + cls}>
      <div className="icon">{icon}</div>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{sub}</em>
      </div>
    </div>
  )
}

function Bar({ label, value }) {
  return (
    <div className="barrow">
      <span>{label}<b>{value}%</b></span>
      <i><u style={{ width: value + '%' }} /></i>
    </div>
  )
}

function formatDate(value, time = false) {
  const d = new Date(value)

  if (Number.isNaN(d.getTime())) return '—'

  return new Intl.DateTimeFormat(
    'es-CO',
    time
      ? { hour: '2-digit', minute: '2-digit', timeZone: TZ }
      : { day: '2-digit', month: 'short', timeZone: TZ }
  ).format(d)
}

export default function App() {
  const [session, setSession] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [league, setLeague] = useState('')
  const [market, setMarket] = useState('Todos')
  const [min, setMin] = useState(70)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) {
      loadDashboard()
    }
  }, [session])

  async function loadDashboard() {
    setLoading(true)
    setError('')

    try {
      const [leagueResult, matchResult, teamResult] = await Promise.all([
        supabase
          .from('leagues')
          .select('id,name,country')
          .order('name'),

        supabase
          .from('matches')
          .select(
            'id,league_id,home_team_id,away_team_id,kickoff_at,status,home_score,away_score'
          )
          .order('kickoff_at')
          .limit(300),

        supabase
          .from('teams')
          .select('id,name')
          .limit(500)
      ])

      if (leagueResult.error) throw leagueResult.error
      if (matchResult.error) throw matchResult.error
      if (teamResult.error) throw teamResult.error

      setLeagues(leagueResult.data || [])
      setMatches(matchResult.data || [])
      setTeams(teamResult.data || [])
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar los datos.')
    } finally {
      setLoading(false)
    }
  }

  const leagueMap = useMemo(
    () => new Map(leagues.map(item => [String(item.id), item.name])),
    [leagues]
  )

  const teamMap = useMemo(
    () => new Map(teams.map(item => [String(item.id), item.name])),
    [teams]
  )

  const filtered = matches.filter(
    match => !league || String(match.league_id) === String(league)
  )

  const upcoming = filtered.filter(match => {
    const d = new Date(match.kickoff_at)
    return !Number.isNaN(d.getTime()) && d > new Date()
  })

  const finished = filtered.filter(
    match => match.home_score != null && match.away_score != null
  )

  const live = filtered.filter(match =>
    ['LIVE', '1H', '2H', 'HT'].includes(match.status)
  ).length

  if (!session) {
    return (
      <main>
        <Auth onAuthenticated={setSession} />
      </main>
    )
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <b>A</b>
          <div>
            ACCA
            <span>GENERATOR 4</span>
          </div>
        </div>

        <nav>
          <button className="active">⌂ Dashboard</button>
          <button>⚽ Partidos</button>
          <button>◈ Predicciones</button>
          <button>▦ ACCA Builder</button>
          <button>◒ Estadísticas</button>
          <button>◷ Historial</button>
        </nav>

        <div className="sidebottom">
          <p>
            ● Motor online
            <small>v0.1</small>
          </p>

          <button onClick={() => supabase.auth.signOut()}>
            ↪ Cerrar sesión
          </button>
        </div>
      </aside>

      <section className="page">
        <header>
          <div>
            <small>CONTROL CENTER</small>
            <h1>Dashboard</h1>
          </div>

          <div className="headright">
            ● Bogotá · GMT-5
            <span>{session.user.email}</span>
            <button onClick={loadDashboard}>↻</button>
          </div>
        </header>

        {error && (
          <div className="alert">
            ⚠ {error}
          </div>
        )}

        <div className="hero">
          <div>
            <label>SMART FOOTBALL ANALYTICS</label>

            <h2>
              Construye ACCAs con
              <br />
              <i>probabilidad y valor.</i>
            </h2>

            <p>
              Centro de control para analizar partidos, mercados y oportunidades.
            </p>
          </div>

          <strong>⚽</strong>
        </div>

        <div className="stats">
          <Stat
            icon="⚽"
            label="PARTIDOS"
            value={loading ? '—' : filtered.length}
            sub={upcoming.length + ' próximos'}
            cls="p"
          />

          <Stat
            icon="◉"
            label="LIGAS"
            value={loading ? '—' : leagues.length}
            sub="Configuradas"
            cls="c"
          />

          <Stat
            icon="◆"
            label="FINALIZADOS"
            value={loading ? '—' : finished.length}
            sub="Históricos"
            cls="o"
          />

          <Stat
            icon="⚡"
            label="EN VIVO"
            value={live}
            sub="Estado actual"
            cls="g"
          />
        </div>

        <div className="grid">
          <div className="panel">
            <div className="title">
              <div>
                <h3>Próximos partidos</h3>
                <p>America/Bogota</p>
              </div>

              <button onClick={loadDashboard}>
                Actualizar
              </button>
            </div>

            <div className="filters">
              <select
                value={league}
                onChange={e => setLeague(e.target.value)}
              >
                <option value="">Todas las ligas</option>

                {leagues.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>

              <select
                value={market}
                onChange={e => setMarket(e.target.value)}
              >
                <option>Todos</option>
                <option>1X2</option>
                <option>BTTS</option>
                <option>Over/Under</option>
                <option>Corners</option>
                <option>Cards</option>
                <option>Shots</option>
              </select>

              <label>
                Prob. ≥
                <input
                  type="number"
                  value={min}
                  min="50"
                  max="99"
                  onChange={e =>
                    setMin(Number(e.target.value) || 70)
                  }
                />
                %
              </label>
            </div>

            {upcoming.slice(0, 8).map(match => (
              <div className="match" key={match.id}>
                <div>
                  <b>{formatDate(match.kickoff_at)}</b>
                  <small>
                    {formatDate(match.kickoff_at, true)}
                  </small>
                </div>

                <strong>
                  {teamMap.get(String(match.home_team_id)) ||
                    'Equipo #' + match.home_team_id}

                  <span>vs</span>

                  {teamMap.get(String(match.away_team_id)) ||
                    'Equipo #' + match.away_team_id}
                </strong>

                <label>
                  {leagueMap.get(String(match.league_id)) || 'Liga'}
                </label>

                <em>
                  {Math.max(70, min)}%
                </em>

                <button aria-label="Abrir partido">
                  →
                </button>
              </div>
            ))}

            {!upcoming.length && (
              <div className="empty">
                No hay próximos partidos almacenados todavía.
              </div>
            )}
          </div>

          <div className="panel health">
            <div className="title">
              <div>
                <h3>Salud del motor</h3>
                <p>Estado de componentes</p>
              </div>

              <mark>LIVE</mark>
            </div>

            <Bar
              label="Base de datos"
              value={100}
            />

            <Bar
              label="Team Metrics"
              value={100}
            />

            <Bar
              label="Features"
              value={85}
            />

            <Bar
              label="Predicciones"
              value={55}
            />

            <Bar
              label="Cuotas"
              value={15}
            />

            <div className="note">
              ⚡ Datos externos pendientes de conexión completa
            </div>
          </div>
        </div>

        <div className="bottom">
          <div className="panel acca">
            <label>ACCA ENGINE</label>

            <h3>
              Generador preparado
            </h3>

            <p>
              Probabilidad mínima <b>70%</b> ·
              Cuota individual <b>1.30–2.20</b> ·
              Total <b>5–200</b>
            </p>

            <button>
              ABRIR ACCA BUILDER →
            </button>
          </div>

          <div className="panel sources">
            <h3>Fuentes de datos</h3>

            <div>
              <span>API-Football</span>
              <span>Sportmonks</span>
              <span>Football-data</span>
              <span>Flashscore*</span>
            </div>

            <small>
              * Fuente provisional / referencia pública
            </small>
          </div>
        </div>
      </section>
    </div>
  )
}