// Supabase Edge Function: validate-invite
//
// Server-side validation of invite codes. Replaces the previous client-side
// switch in app/login.tsx that exposed ADMINKKZ2026 / KZ2026 etc. in the public
// bundle.
//
// Codes live in Supabase Function secrets (NOT in the repo, NOT in env files
// shipped to the client):
//   INVITE_ADMIN_PROD, INVITE_PLAYER_PROD, INVITE_ADMIN_DEV, INVITE_PLAYER_DEV
//
// The role/is_dev flags are written to auth.users.raw_app_meta_data (a.k.a.
// app_metadata) using the service role key. That field is read-only from the
// client — even a malicious user calling supabase.auth.updateUser({ data: {...} })
// only writes user_metadata, never app_metadata.
//
// Deploy:
//   supabase functions deploy validate-invite --no-verify-jwt=false
//   supabase secrets set INVITE_ADMIN_PROD=... INVITE_PLAYER_PROD=... \
//                        INVITE_ADMIN_DEV=...  INVITE_PLAYER_DEV=...

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CODES = {
    admin_prod:  Deno.env.get('INVITE_ADMIN_PROD')  || '',
    player_prod: Deno.env.get('INVITE_PLAYER_PROD') || '',
    admin_dev:   Deno.env.get('INVITE_ADMIN_DEV')   || '',
    player_dev:  Deno.env.get('INVITE_PLAYER_DEV')  || '',
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

function resolveRole(code: string): { role: 'admin' | 'participant'; is_dev: boolean } | null {
    const c = (code || '').trim().toUpperCase();
    if (!c) return null;
    if (CODES.admin_prod  && c === CODES.admin_prod.toUpperCase())  return { role: 'admin',       is_dev: false };
    if (CODES.player_prod && c === CODES.player_prod.toUpperCase()) return { role: 'participant', is_dev: false };
    if (CODES.admin_dev   && c === CODES.admin_dev.toUpperCase())   return { role: 'admin',       is_dev: true  };
    if (CODES.player_dev  && c === CODES.player_dev.toUpperCase())  return { role: 'participant', is_dev: true  };
    return null;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed' }, 405);
    }

    // Identify the caller from the JWT. Supabase Edge Functions verify the JWT
    // automatically when `verify_jwt = true` (the default).
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse({ error: 'missing_auth' }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
        return jsonResponse({ error: 'invalid_jwt' }, 401);
    }
    const userId = userData.user.id;

    // Body
    let body: { code?: string };
    try { body = await req.json(); }
    catch { return jsonResponse({ error: 'bad_json' }, 400); }

    const resolved = resolveRole(body.code || '');
    if (!resolved) {
        return jsonResponse({ error: 'invalid_invite' }, 403);
    }

    // Write to app_metadata via admin API (service role required).
    // Also clear `pending_invite_code` de user_metadata si estaba (signup vía
    // email confirmation lo deja ahí como buzón para que se procese al primer login).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const newUserMeta = { ...(userData.user.user_metadata || {}) };
    if ('pending_invite_code' in newUserMeta) delete newUserMeta.pending_invite_code;

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: {
            ...(userData.user.app_metadata || {}),
            role:   resolved.role,
            is_dev: resolved.is_dev,
        },
        user_metadata: newUserMeta,
    });
    if (updErr) {
        console.error('validate-invite update failed:', updErr.message);
        return jsonResponse({ error: 'update_failed' }, 500);
    }

    return jsonResponse({ ok: true, role: resolved.role, is_dev: resolved.is_dev });
});
