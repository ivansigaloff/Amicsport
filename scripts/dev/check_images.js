const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

async function checkImages() {
  const { data, error } = await supabase.from('matches_dev').select('id, title, image_url').limit(5);
  if (error) {
    console.error('Error fetching matches:', error);
    return;
  }
  console.log('Matches with images:');
  data.forEach(m => {
    console.log(`- ${m.title}: ${m.image_url}`);
  });
}

checkImages();
