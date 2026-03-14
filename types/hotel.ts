/** Input parameters for the hotel/room search query */
export interface HotelSearchInput {
  lat: number;
  lon: number;
  checkin: string; // date (ISO or YYYY-MM-DD)
  checkout: string; // date (ISO or YYYY-MM-DD)
  adults: number;
  children: number | null;
  rooms: number;
}

/** Single row returned from the SQL query (one room option per property) */
export interface HotelSearchResult {
  property_id: string;
  property_name: string;
  city: string;
  country: string;
  room_id: string;
  room_name: string;
  room_description: string;
  price_per_night: number;
  total_price: number;
  currency: string;
}
