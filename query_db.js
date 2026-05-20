require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const { data, error } = await supabase.from('matches').select('*');
  if (error) {
    console.error('Error fetching matches:', error);
    return;
  }
  
  console.log('Matches fetched:', data.length);
  
  data.forEach(match => {
    console.log(match.id, '|', match.title, '|', match.location);
  });
}

main();
