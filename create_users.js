/**
 * Script para crear usuarios de prueba en Supabase Auth
 * Requiere la SERVICE ROLE KEY (no la anon key)
 *
 * Cómo obtenerla:
 *   Supabase Dashboard → Settings → API → service_role (secret)
 *
 * Ejecución:
 *   node create_users.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://wdidrnqjcdhmultayvgq.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Se lee de .env.local (ignorado por Git)

const PASSWORD  = 'TestKKZ1!';
const ROLE_CODE = 'KZ2026';
const ROLE_NAME = 'participante';

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
        user_metadata: {
          full_name: name,
          role: ROLE_NAME,
          role_code: ROLE_CODE,
        },
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
