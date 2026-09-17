export type Stylist = {
  id: string;
  name: string;
  role: string | null;
};

export type Service = {
  id: string;
  name: string;
  duration_min: number;
  price_cents: number | null;
};

export type Booking = {
  id: string;
  stylist_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  customer_name: string | null;
  source: "web" | "whatsapp" | "phone" | "panel";
  created_at: string;
};
