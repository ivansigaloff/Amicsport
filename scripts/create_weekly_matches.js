require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
// Google Maps key for the Places photo URLs below. Read from .env — NEVER inline
// it: this repo is public and a leaked key gets billed to your account.
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const metadata = {
  Satalia: {
    venue: "Satalia",
    location_url: "https://www.google.com/maps/place/Campo+Municipal+de+F%C3%BAtbol+de+la+Satalia/@41.3703383,2.1599696,17z/data=!3m1!4b1!4m6!3m5!1s0x12a4a2688f4706d3:0x67400efcdf0c961a!8m2!3d41.3703383!4d2.1625445!16s%2Fg%2F11r930tff?entry=ttu&g_ep=EgoyMDI2MDQwNS4wIKXMDSoASAFQAw%3D%3D",
    image_url: `https://places.googleapis.com/v1/places/ChIJ0wZHj2iipBIRGpYM3_wOQGc/photos/AU_ZVEG7sKJInnPainOzkVPAZPkWiGw54dspYV2ssTbxEqYWkcABlNZv17BHtBXXgPMWZFFUVKM5ULkwZwUqxSTh30r6tlueFjMSmZ7ZRJcSMIFZ07AZkYSoqgGDoBh6Gw3LpBwcJizCEVR2gYAjIXQcGKluALPZVRimQo7yEppr3OtO_xCorxBBUJygQpE35IW_HiT-QnxCV4a9WbDpFTh5-0TW-8kf2UqX3CILgXCWS5filNuWt4A9M1su1EjYhVpOYadrlSHJiHCowqJ3mmjx7drR8FxO_6KYbubMcKn900hlMWeqEVitRd33J-3uC5m98gbFQDWpVOQj6wNPtlVNwjxvrCbh9pqa8W0RKhFiMuJdG49qyM-tcPt91_6zjC107M1nKRh3V2GvvoR4BNhcw59j_bZdjhc_2Ij1DjwFxkjwbpN1/media?maxWidthPx=800&key=${GOOGLE_MAPS_API_KEY}`
  },
  Iberia: {
    venue: "Iberia",
    location_url: "https://www.google.com/maps/place/Campo+de+F%C3%BAtbol+Municipal+Iberia+PreviousNext/@41.3563312,2.1420681,17z/data=!3m1!4b1!4m6!3m5!1s0x12a498a0ac94c815:0x9dce0ada5ae4c7ee!8m2!3d41.3563272!4d2.144643!16s%2Fg%2F11c7_x209d?entry=ttu&g_ep=EgoyMDI2MDQwOC4wIKXMDSoASAFQAw%3D%3D",
    image_url: `https://places.googleapis.com/v1/places/ChIJFciUrKCYpBIR7sfkWtoKzp0/photos/AU_ZVEHyfDJwOEh97s3akbYUBF57PvhFhrZnYik8TRu3KH_Dfll9DlBQTaqBYgcjXq62Ipg7YUdndwREdHiias3HN_pLd3JdETdLDVIEx5B4snAVLpZq4qgSuGabkJGV04wd7xKJX83sZmhz0OOw6a-gluT4nsLYPLQ4CYpki-KtUbXd-_4im192Z_gJTW4N2MIian3nb24X-VP55c_Qz96FWlwCzbwXC1oExVeGxKo9TTnIia0XgVyiFCDrKn9yVQz8VG490iaj_Gc5eshLDAS_cxlRoBcltAolqQp8A60VXbw5H8HNVKJYshddzvwDKKLIQgvOw2uwwfNsQNFvG32kA6bjXe2BAYrletyaE9oVxj_1wbTd8XDRddJ9jk5O3lK0WwVFADAvfA6MZhKSxZjw4HG6e0Ai-u8EE9eH5K1t3GD04lGm/media?maxWidthPx=800&key=${GOOGLE_MAPS_API_KEY}`
  }
};

const matchesToCreate = [
  { 
    title: "F7 La Satalia",
    venue: metadata.Satalia.venue,
    date: "Vie, 24 abr",
    time: "21:30",
    price: 6,
    max_players: 14,
    distance: "7v7",
    location_url: metadata.Satalia.location_url,
    image_url: metadata.Satalia.image_url,
    level: "Abierto a todos"
  },
  { 
    title: "F7 La Satalia",
    venue: metadata.Satalia.venue,
    date: "Dom, 26 abr",
    time: "08:00",
    price: 6,
    max_players: 14,
    distance: "7v7",
    location_url: metadata.Satalia.location_url,
    image_url: metadata.Satalia.image_url,
    level: "Abierto a todos"
  },
  { 
    title: "F8 La Satalia",
    venue: metadata.Satalia.venue,
    date: "Dom, 26 abr",
    time: "08:00",
    price: 6,
    max_players: 16,
    distance: "8v8",
    location_url: metadata.Satalia.location_url,
    image_url: metadata.Satalia.image_url,
    level: "Abierto a todos"
  },
  { 
    title: "F7 La Satalia",
    venue: metadata.Satalia.venue,
    date: "Dom, 26 abr",
    time: "09:00",
    price: 6,
    max_players: 14,
    distance: "7v7",
    location_url: metadata.Satalia.location_url,
    image_url: metadata.Satalia.image_url,
    level: "Abierto a todos"
  },
  { 
    title: "F7 Satalia contra Replayers",
    venue: metadata.Satalia.venue,
    date: "Dom, 26 abr",
    time: "10:00",
    price: 6,
    max_players: 14,
    distance: "7v7",
    location_url: metadata.Satalia.location_url,
    image_url: metadata.Satalia.image_url,
    level: "Abierto a todos"
  },
  { 
    title: "F8 Iberia",
    venue: metadata.Iberia.venue,
    date: "Dom, 26 abr",
    time: "20:00",
    price: 6,
    max_players: 16,
    distance: "8v8",
    location_url: metadata.Iberia.location_url,
    image_url: metadata.Iberia.image_url,
    level: "Abierto a todos"
  }
];

async function run() {
  const tables = ['matches', 'matches_dev'];
  
  for (const table of tables) {
    console.log(`Inserting into ${table}...`);
    const { data, error } = await supabase.from(table).insert(
      matchesToCreate.map(m => ({ ...m, joined_players: 0 }))
    ).select();
    
    if (error) {
      console.error(`Error in ${table}:`, error.message);
    } else {
      console.log(`Successfully inserted ${data.length} matches into ${table}.`);
    }
  }
}

run();
