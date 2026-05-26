import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

export interface AuditEntry {
  env?: string;
  actor_id?: string;
  actor_email?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  payload?: object;
  source?: string;
}

// Fire-and-forget: never throws — audit failures must not block business logic
export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await adminClient.from('audit_log').insert({
      env:         entry.env        ?? 'prod',
      actor_id:    entry.actor_id,
      actor_email: entry.actor_email,
      action:      entry.action,
      entity_type: entry.entity_type,
      entity_id:   entry.entity_id,
      payload:     entry.payload,
      source:      entry.source     ?? 'app',
    });
  } catch (e) {
    console.error('[audit] Failed to write log:', e);
  }
}
