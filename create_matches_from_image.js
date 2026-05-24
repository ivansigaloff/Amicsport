require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const googleKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

const venues = {
  Satalia: {
    venue: 'Satalia',
    image_url: `https://places.googleapis.com/v1/places/ChIJ0wZHj2iipBIRGpYM3_wOQGc/photos/AU_ZVEG7sKJInnPainOzkVPAZPkWiGw54dspYV2ssTbxEqYWkcABlNZv17BHtBXXgPMWZFFUVKM5ULkwZwUqxSTh30r6tlueFjMSmZ7ZRJcSMIFZ07AZkYSoqgGDoBh6Gw3LpBwcJizCEVR2gYAjIXQcGKluALPZVRimQo7yEppr3OtO_xCorxBBUJygQpE35IW_HiT-QnxCV4a9WbDpFTh5-0TW-8kf2UqX3CILgXCWS5filNuWt4A9M1su1EjYhVpOYadrlSHJiHCowqJ3mmjx7drR8FxO_6KYbubMcKn900hlMWeqEVitRd33J-3uC5m98gbFQDWpVOQj6wNPtlVNwjxvrCbh9pqa8W0RKhFiMuJdG49qyM-tcPt91_6zjC107M1nKRh3V2GvvoR4BNhcw59j_bZdjhc_2Ij1DjwFxkjwbpN1/media?maxWidthPx=800&key=${googleKey}`,
    location_url: 'https://www.google.com/maps/place/Campo+Municipal+de+F%C3%BAtbol+de+la+Satalia/@41.3703383,2.1599696,17z/data=!3m1!4b1!4m6!3m5!1s0x12a4a2688f4706d3:0x67400efcdf0c961a!8m2!3d41.3703383!4d2.1625445!16s%2Fg%2F11r930tff?entry=ttu&g_ep=EgoyMDI2MDQwNS4wIKXMDSoASAFQAw%3D%3D'
  },
  Iberia: {
    venue: 'Iberia',
    image_url: `https://places.googleapis.com/v1/places/ChIJFciUrKCYpBIR7sfkWtoKzp0/photos/AU_ZVEHyfDJwOEh97s3akbYUBF57PvhFhrZnYik8TRu3KH_Dfll9DlBQTaqBYgcjXq62Ipg7YUdndwREdHiias3HN_pLd3JdETdLDVIEx5B4snAVLpZq4qgSuGabkJGV04wd7xKJX83sZmhz0OOw6a-gluT4nsLYPLQ4CYpki-KtUbXd-_4im192Z_gJTW4N2MIian3nb24X-VP55c_Qz96FWlwCzbwXC1oExVeGxKo9TTnIia0XgVyiFCDrKn9yVQz8VG490iaj_Gc5eshLDAS_cxlRoBcltAolqQp8A60VXbw5H8HNVKJYshddzvwDKKLIQgvOw2uwwfNsQNFvG32kA6bjXe2BAYrletyaE9oVxj_1wbTd8XDRddJ9jk5O3lK0WwVFADAvfA6MZhKSxZjw4HG6e0Ai-u8EE9eH5K1t3GD04lGm/media?maxWidthPx=800&key=${googleKey}`,
    location_url: 'https://www.google.com/maps/place/Campo+de+F%C3%BAtbol+Municipal+Iberia+PreviousNext/@41.3563312,2.1420681,17z/data=!3m1!4b1!4m6!3m5!1s0x12a498a0ac94c815:0x9dce0ada5ae4c7ee!8m2!3d41.3563272!4d2.144643!16s%2Fg%2F11c7_x209d?entry=ttu&g_ep=EgoyMDI2MDQwOC4wIKXMDSoASAFQAw%3D%3D'
  }
};

const matchesToCreate = [
  {
    title: 'F7 La Satalia',
    venue: 'Satalia',
    date: 'Vie, 22 may',
    time: '21:30',
    max_players: 14,
    ...venues.Satalia
  },
  {
    title: 'F7 La Satalia',
    venue: 'Satalia',
    date: 'Dom, 24 may',
    time: '08:00',
    max_players: 14,
    ...venues.Satalia
  },
  {
    title: 'F7 La Satalia',
    venue: 'Satalia',
    date: 'Dom, 24 may',
    time: '09:00',
    max_players: 14,
    ...venues.Satalia
  },
  {
    title: 'F8 Iberia',
    venue: 'Iberia',
    date: 'Dom, 24 may',
    time: '20:00',
    max_players: 16,
    ...venues.Iberia
  }
];

const commonFields = {
  price: 6,
  joined_players: 0,
  level: 'Abierto a todos',
  distance: 'Apto',
  is_female: false,
  is_mixed: false,
  is_private: false,
  is_advanced: false
};

async function main() {
  const dataToInsert = matchesToCreate.map(match => ({
    ...match,
    ...commonFields
  }));

  console.log('Inserting', dataToInsert.length, 'matches into PROD and DEV...');
  
  // Insertar en PROD
  const { data: dataProd, error: errorProd } = await supabase.from('matches').insert(dataToInsert).select();
  if (errorProd) console.error('Error inserting matches into matches:', errorProd);
  else console.log('Successfully inserted matches into matches');

  // Insertar en DEV
  const { data: dataDev, error: errorDev } = await supabase.from('matches_dev').insert(dataToInsert).select();
  if (errorDev) console.error('Error inserting matches into matches_dev:', errorDev);
  else console.log('Successfully inserted matches into matches_dev');

  if (!errorProd && !errorDev) {
    console.log('Finished successfully.');
  }
}

main();
