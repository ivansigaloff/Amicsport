// Auth helpers — single source of truth for reading the user's role.
//
// SECURITY: role MUST be read from `app_metadata` (server-only writes via the
// service role). getUserRole does NOT fall back to user_metadata (user-writable),
// so a user cannot self-elevate to admin.

type AnyUser = {
    app_metadata?: { role?: string; is_dev?: boolean; [k: string]: any } | null;
    user_metadata?: { role?: string; is_dev?: boolean; [k: string]: any } | null;
    email?: string | null;
} | null | undefined;

export type Role = 'admin' | 'participant';

export function getUserRole(user: AnyUser): Role {
    const fromApp = user?.app_metadata?.role;
    if (fromApp === 'admin' || fromApp === 'participant') return fromApp;
    // role lives ONLY in app_metadata (server-written via validate-invite).
    // No user_metadata fallback: it is user-writable, so trusting it would let
    // any user self-elevate to admin. Unknown/absent → least privilege.
    return 'participant';
}

/**
 * Resolves whether the current viewer should see admin UI.
 * Single environment: an admin is simply role === 'admin'.
 * (The optional env param is kept for call-site compatibility and ignored.)
 */
export function computeIsAdmin(user: AnyUser, _env?: 'prod' | 'dev'): boolean {
    return getUserRole(user) === 'admin';
}
