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

// Use the resilient sync v2 function. It returns a structured 200 response
// even when one or more TheSportsDB days fail, so partial data does not break
// the application's synchronization flow.
if (client) {
  const invoke = client.functions.invoke.bind(client.functions)
  client.functions.invoke = (name, options) =>
    invoke(name === 'thesportsdb-sync' ? 'thesportsdb-sync-v2' : name, options)
}

export const supabase = client
