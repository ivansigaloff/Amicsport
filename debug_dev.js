const { createClient } = require('@supabase/supabase-js');

const url = 'https://wdidrnqjcdhmultayvgq.supabase.co';
const key = 'sb_publishable_nApFd8tM47kxkbWstiOgyw_yaJZjUui';

async function debug() {
    const supabase = createClient(url, key);
    
    console.log('Fetching latest match from DEV...');
    const { data, error } = await supabase.from('matches_dev').select('*').order('created_at', { ascending: false }).limit(1);
    
    if (error) {
        console.error('Error:', error);
    } else if (data && data.length > 0) {
        console.log('Match found in DEV:', JSON.stringify(data[0], null, 2));
    } else {
        console.log('No matches found in DEV.');
    }
}

debug();
