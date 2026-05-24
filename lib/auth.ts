// Auth helpers — single source of truth for reading role/is_dev from a Supabase user.
//
// SECURITY: role/is_dev MUST be read from `app_metadata` (server-only writes via
// service role). The fallback to `user_metadata` is TEMPORARY for users created
// before supabase/migrations/20260522000000_secure_roles.sql was applied. Once the
// migration has run AND the deletion block (STEP 2) has been executed, the
// fallback can be removed.

type AnyUser = {
    app_metadata?: { role?: string; is_dev?: boolean; [k: string]: any } | null;
    user_metadata?: { role?: string; is_dev?: boolean; [k: string]: any } | null;
    email?: string | null;
} | null | undefined;

export type Role = 'admin' | 'participant';

export function getUserRole(user: AnyUser): Role {
    const fromApp = user?.app_metadata?.role;
    if (fromApp === 'admin' || fromApp === 'participant') return fromApp;
    // Backward compat — pre-migration users
    const fromUserMeta = user?.user_metadata?.role;
    if (fromUserMeta === 'admin' || fromUserMeta === 'participant') return fromUserMeta;
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
