/**
 * Script para crear usuarios de prueba en Supabase Auth
 * Requiere la SERVICE ROLE KEY (no la anon key)
 *
 * Cómo obtenerla:
 *   Supabase Dashboard → Settings → API → service_role (secret)
 *
 * Ejecución:
 *   node scripts/dev/create_users.js
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Se lee de .env.local (ignorado por Git)

// SECURITY: the test users' password lives ONLY in .env (E2E_TEST_PASSWORD).
// The repo is public — a literal here would let anyone log in as a test player.
const PASSWORD  = process.env.E2E_TEST_PASSWORD || '';
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PASSWORD) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or E2E_TEST_PASSWORD in .env/.env.local');
  process.exit(1);
}

// Nombres reales (excluidos invitados con sufijo numérico)
const PLAYERS = [
  'Edu', 'Paisa', 'Felix', 'Nico', 'Ogdier', 'Delvis', 'Oussama',
  'Adam', 'Alex', 'Cristian', 'Bony', 'Bob', 'Luis Jr', 'Moha',
  'Luis', 'Elkin', 'Andres', 'Cali', 'Johnatan', 'David', 'Paul', 'Percy'
];

// Convierte "Luis Jr" → "luisjr"
function toEmailSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createUsers() {
  console.log(`\nCreando ${PLAYERS.length} usuarios...\n`);

  for (const name of PLAYERS) {
    const email = `${toEmailSlug(name)}@testusers.com`;

    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true, // Sin necesidad de verificar email
        // Only display data here. Roles live in app_metadata and are granted
        // by validate-invite; user_metadata is user-writable and never trusted.
        user_metadata: { full_name: name },
      });

      if (error) {
        console.error(`❌ ${name} (${email}): ${error.message}`);
      } else {
        console.log(`✅ ${name} → ${email}  (id: ${data.user.id})`);
      }
    } catch (err) {
      console.error(`💥 ${name}: ${err.message}`);
    }
  }

  console.log('\nProceso completado.');
}

createUsers();
