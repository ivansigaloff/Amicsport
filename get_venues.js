require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('dev_matches').select('venue, image_url');
  if (error) { console.error(error); return; }
  
  const map = {};
  for (const m of data) {
    if (m.venue && !map[m.venue]) {
      map[m.venue] = m.image_url;
    }
  }
  console.log(JSON.stringify(map, null, 2));
}

run();
