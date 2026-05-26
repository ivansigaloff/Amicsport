export interface Match {
  id: string;
  title: string;
  venue: string;
  date: string;
  time: string;
  price: number;
  max_players: number;
  joined_players: number;
  location_url?: string;
  image_url?: string;
  distance?: string;
  level?: string;
  is_female?: boolean;
  is_mixed?: boolean;
  is_private?: boolean;
  is_advanced?: boolean;
  cancellation_hours?: number;
  creator_email?: string;
  created_at?: string;
  updated_at?: string;
  // Client-side computed field added by the match list query
  computed_joined?: number;
}

export interface Participant {
  id: string;
  match_id: string;
  user_id: string | null;
  user_name: string;
  created_at?: string;
}

export interface AdminPlayer {
  id: string;
  name: string;
  level?: string;
  phone?: string;
  created_at?: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  location_url?: string;
  image_url?: string;
  created_at?: string;
}

export interface CancellationDeadline {
  date: string;
  time: string;
  isPast: boolean;
  limitHours: number;
}
