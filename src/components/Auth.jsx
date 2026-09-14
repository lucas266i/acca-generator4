import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) {
        onAuthenticated(data.session)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        onAuthenticated(session)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [onAuthenticated])

  async function submit(event) {
    event.preventDefault()

    if (!supabase) {
      setMessage('Configura primero las variables de Supabase.')
      return
    }

    setBusy(true)
    setMessage('')

    const result =
      mode === 'signup'
        ? await supabase.auth.signUp({
            email,
            password,
          })
        : await supabase.auth.signInWithPassword({
            email,
            password,
          })

    if (result.error) {
      setMessage(result.error.message)
    } else if (mode === 'signup' && !result.data.session) {
      setMessage('Revisa tu correo para confirmar la cuenta.')
    }

    setBusy(false)
  }

  async function resetPassword() {
    if (!supabase) {
      setMessage('Configura primero las variables de Supabase.')
      return
    }

    if (!email) {
      setMessage('Escribe tu correo primero.')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })

    setMessage(
      error
        ? error.message
        : 'Te enviamos un enlace para restablecer la contraseña.'
    )
  }

  return (
    <section className="card">
      <h1>ACCA Generator 4</h1>

      <p>
        {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
      </p>

      <form onSubmit={submit}>
        <input
          type="email"
          placeholder="Correo"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          required
        />

        <button type="submit" disabled={busy}>
          {busy
            ? 'Procesando...'
            : mode === 'login'
              ? 'Entrar'
              : 'Registrarme'}
        </button>
      </form>

      <button
        type="button"
        className="link"
        onClick={() =>
          setMode(mode === 'login' ? 'signup' : 'login')
        }
      >
        {mode === 'login'
          ? 'Crear una cuenta'
          : 'Ya tengo una cuenta'}
      </button>

      {mode === 'login' && (
        <button
          type="button"
          className="link"
          onClick={resetPassword}
        >
          Olvidé mi contraseña
        </button>
      )}

      {message && <p className="message">{message}</p>}
    </section>
  )
}
