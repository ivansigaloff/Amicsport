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
  requires_payment?: boolean;
  payment_deadline_hours?: number;
  creator_email?: string;
  created_at?: string;
  updated_at?: string;
  // Client-side computed field added by the match list query
  computed_joined?: number;
}

export type PaymentStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'EXPIRED'
  | 'PENDING_REFUND_ADMIN';

export interface Payment {
  id: string;
  env: 'prod' | 'dev';
  match_id: string;
  participant_id?: string;
  user_id: string;
  user_name: string;
  user_email?: string;
  monei_payment_id?: string;
  order_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_method?: string;
  is_guest: boolean;
  refunded_amount: number;
  refunded_at?: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
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
