/**
 * Tipos de la base de datos.
 *
 * ESTE ARCHIVO SE GENERA, NO SE EDITA A MANO:
 *   npm run gen:types
 *
 * Contiene solo la migración 0001 (fundación de sistema). Las tablas de negocio
 * — items, acquisitions, orders, payments, etc. — entran en la Fase 1.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          role: Database["public"]["Enums"]["user_role"];
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role?: Database["public"]["Enums"]["user_role"];
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["user_role"] | null;
      };
    };
    Enums: {
      user_role: "owner" | "admin" | "staff" | "viewer" | "consignor";
    };
    CompositeTypes: Record<never, never>;
  };
};

export type UserRole = Database["public"]["Enums"]["user_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
