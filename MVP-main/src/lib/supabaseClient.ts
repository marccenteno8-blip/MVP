import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (copia .env.example a .env)"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
