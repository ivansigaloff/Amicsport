require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const { data, error } = await supabase.from('matches').select('venue');
  if (error) {
    console.error('Error fetching venues:', error);
    return;
  }
  
  const venues = [...new Set(data.map(m => m.venue))];
  console.log('Venues:', venues);
}

main();
