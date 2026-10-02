import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const client =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null

// The original thesportsdb-sync function has a stale import-map configuration
// that prevents new deployments. Route the frontend to the clean v2 function
// while keeping the rest of the application API unchanged.
if (client) {
  const invoke = client.functions.invoke.bind(client.functions)
  client.functions.invoke = (name, options) =>
    invoke(name === 'thesportsdb-sync' ? 'thesportsdb-sync-v2' : name, options)
}

export const supabase = client
