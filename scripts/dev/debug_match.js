require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
    process.exit(1);
}

async function debug() {
    const supabase = createClient(url, key);
    
    console.log('Fetching latest match from production...');
    const { data, error } = await supabase.from('matches').select('*').order('created_at', { ascending: false }).limit(1);
    
    if (error) {
        console.error('Error:', error);
    } else if (data && data.length > 0) {
        console.log('Match found:', JSON.stringify(data[0], null, 2));
        console.log('\nColumns present:', Object.keys(data[0]));
    } else {
        console.log('No matches found.');
    }
}

debug();
