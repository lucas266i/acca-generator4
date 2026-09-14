import React, { useCallback, useState } from 'react'
import Auth from './components/Auth'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const authenticated = useCallback((s) => setSession(s), [])
  async function logout() { if (supabase) await supabase.auth.signOut(); setSession(null) }

  if (!session) return <main><Auth onAuthenticated={authenticated} /></main>
  return <main><section className="card"><h1>Dashboard</h1><p>Sesión activa para {session.user.email}</p><button onClick={logout}>Cerrar sesión</button><div className="placeholder"><h2>Motor ACCA</h2><p>Aquí integraremos los filtros, ligas, mercados, cuotas y generación de ACCAs.</p></div></section></main>
}
