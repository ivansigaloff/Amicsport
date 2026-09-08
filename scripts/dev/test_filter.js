
const matches = [
  { id: 1, venue: 'Camp Nou ', date: '2024-04-10' },
  { id: 2, venue: ' CAMP NOU', date: '2024-04-12' },
  { id: 3, venue: 'Camp Nou', date: '2024-04-15' }
];

const selectedVenueFilter = 'Camp Nou';

const filtered = matches.filter(m => m.venue.trim().toLowerCase() === selectedVenueFilter.trim().toLowerCase());
console.log('Matches found:', filtered.length);
console.log('Details:', filtered);
