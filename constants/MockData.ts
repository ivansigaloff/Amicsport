export interface Match {
  id: string;
  title: string;
  venue: string;
  date: string;
  time: string;
  price: number;
  maxPlayers: number;
  joinedPlayers: number;
  level: string;
  imageUrl: string;
  distance: string;
}

export const MOCK_MATCHES: Match[] = [
  {
    id: '1',
    title: 'Fútbol 7 - Cesped Artificial',
    venue: 'Polideportivo Centro',
    date: 'Hoy, 20:00',
    time: '20:00 - 21:00',
    price: 6.50,
    maxPlayers: 14,
    joinedPlayers: 12,
    level: 'Amateur / Medio',
    imageUrl: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=600&auto=format&fit=crop',
    distance: '2.5 km'
  },
  {
    id: '2',
    title: 'Fútbol 5 - Indoor',
    venue: 'Arena La Jaula',
    date: 'Mañana, 19:30',
    time: '19:30 - 20:30',
    price: 5.00,
    maxPlayers: 10,
    joinedPlayers: 10,
    level: 'Avanzado',
    imageUrl: 'https://images.unsplash.com/photo-1551280857-2b9ebf241ac9?q=80&w=600&auto=format&fit=crop',
    distance: '4.1 km'
  },
  {
    id: '3',
    title: 'Fútbol 11 - Natural',
    venue: 'Estadio Vistalegre',
    date: '28 de Oct, 18:00',
    time: '18:00 - 19:30',
    price: 8.00,
    maxPlayers: 22,
    joinedPlayers: 15,
    level: 'Todos bienvenidos',
    imageUrl: 'https://images.unsplash.com/photo-1518605368461-1ee7e53028b1?q=80&w=600&auto=format&fit=crop',
    distance: '6.0 km'
  }
];
