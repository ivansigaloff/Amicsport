// Auth helpers — single source of truth for reading role/is_dev from a Supabase user.
//
// SECURITY: role/is_dev MUST be read from `app_metadata` (server-only writes via
// service role). getUserRole no longer falls back to user_metadata (user-writable).
// getUserIsDev still does for legacy users — remove once the DB RLS helper
// auth_is_dev() is migrated off user_metadata.is_dev (see RLS cleanup).

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

export function getUserIsDev(user: AnyUser): boolean {
    if (user?.app_metadata?.is_dev === true) return true;
    if (user?.user_metadata?.is_dev === true) return true;
    // Legacy back-door (audit account) — kept until the user creates a real role-flagged account.
    if (user?.email === 'audit-test@amicsport.com') return true;
    return false;
}

/**
 * Resolves whether the current viewer should see admin UI. Mirrors the original
 * behaviour from useMatch / (tabs)/index / _layout:
 *   - In `dev` env: any admin counts (incluido is_dev=true)
 *   - In `prod` env: solo admins que NO sean is_dev
 */
export function computeIsAdmin(user: AnyUser, env: 'prod' | 'dev'): boolean {
    const role = getUserRole(user);
    if (role !== 'admin') return false;
    if (env === 'dev') return true;
    return !getUserIsDev(user);
}
