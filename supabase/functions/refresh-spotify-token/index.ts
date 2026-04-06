/**
 * refresh-spotify-token — Supabase Edge Function
 *
 * Exchanges the user's stored Spotify refresh token for a new access token,
 * then updates the `users` table.  Running server-side keeps SPOTIFY_CLIENT_SECRET
 * out of the browser entirely.
 *
 * Deploy:
 *   supabase functions deploy refresh-spotify-token
 *
 * Required Supabase secrets (set via `supabase secrets set`):
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *
 * Called from the frontend via:
 *   supabase.functions.invoke('refresh-spotify-token')
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate the calling user via their Supabase JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service-role client to bypass RLS when updating tokens
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the stored refresh token
    const { data: userData, error: dbError } = await supabase
      .from('users')
      .select('spotify_refresh_token')
      .eq('id', user.id)
      .single();

    if (dbError || !userData?.spotify_refresh_token) {
      return new Response(JSON.stringify({ error: 'No refresh token stored. Please log in again.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call Spotify token endpoint
    const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')!;
    const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;
    const credentials = btoa(`${clientId}:${clientSecret}`);

    const spotifyRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: userData.spotify_refresh_token,
      }),
    });

    if (!spotifyRes.ok) {
      const errText = await spotifyRes.text();
      return new Response(JSON.stringify({ error: `Spotify error: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokenData = await spotifyRes.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Persist new access token (and updated refresh token if Spotify rotated it)
    await supabase.from('users').update({
      spotify_access_token: tokenData.access_token,
      token_expires_at: expiresAt,
      ...(tokenData.refresh_token && { spotify_refresh_token: tokenData.refresh_token }),
    }).eq('id', user.id);

    return new Response(
      JSON.stringify({ access_token: tokenData.access_token, expires_at: expiresAt }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
