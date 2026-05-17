'use strict';

const { createClient } = require('@supabase/supabase-js');

/**
 * Two Supabase clients are exported here, each with different levels of privilege.
 *
 * supabase (anon client):
 *   Uses the anon/public key. Subject to Row Level Security (RLS) policies.
 *   Safe to use in all API route handlers that serve external requests.
 *   Use this anywhere the operation should respect the same access rules
 *   that would apply to an authenticated end-user.
 *
 * supabaseAdmin (service role client):
 *   Uses the service role key, which bypasses Row Level Security entirely.
 *   Grants full read/write access to all tables.
 *   ONLY import this in server-side ingestion scripts (e.g. ingest-311-data.js)
 *   and admin-only operations. Never expose it to routes that handle
 *   external HTTP requests. Never import it from any mobile or dashboard code.
 */

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

module.exports = { supabase, supabaseAdmin };
