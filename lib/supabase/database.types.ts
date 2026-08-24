export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_details: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          details: Json
          notes: string | null
          opening_balance: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          details?: Json
          notes?: string | null
          opening_balance?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          details?: Json
          notes?: string | null
          opening_balance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_details_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Relationships: []
      }
      acquisition_lines: {
        Row: {
          acquisition_id: string
          created_at: string
          created_by: string | null
          hammer_price: number
          id: string
          item_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          acquisition_id: string
          created_at?: string
          created_by?: string | null
          hammer_price: number
          id?: string
          item_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          acquisition_id?: string
          created_at?: string
          created_by?: string | null
          hammer_price?: number
          id?: string
          item_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_lines_acquisition_id_fkey"
            columns: ["acquisition_id"]
            isOneToOne: false
            referencedRelation: "acquisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquisition_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquisition_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisitions: {
        Row: {
          buyer_premium: number
          card_fee: number
          courier_ve: number
          created_at: string
          created_by: string | null
          currency: string
          customs_ve: number
          deleted_at: string | null
          due_at: string | null
          fx_rate: number | null
          fx_rate_source: Database["public"]["Enums"]["fx_source"] | null
          hammer_total: number
          id: string
          notes: string | null
          other_costs: number
          payment_status: Database["public"]["Enums"]["acquisition_payment_status"]
          platform: Database["public"]["Enums"]["acquisition_platform"]
          purchased_at: string
          received_status: Database["public"]["Enums"]["acquisition_received_status"]
          reference: string | null
          shipping_intl: number
          total_cost: number | null
          updated_at: string
        }
        Insert: {
          buyer_premium?: number
          card_fee?: number
          courier_ve?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customs_ve?: number
          deleted_at?: string | null
          due_at?: string | null
          fx_rate?: number | null
          fx_rate_source?: Database["public"]["Enums"]["fx_source"] | null
          hammer_total?: number
          id?: string
          notes?: string | null
          other_costs?: number
          payment_status?: Database["public"]["Enums"]["acquisition_payment_status"]
          platform: Database["public"]["Enums"]["acquisition_platform"]
          purchased_at: string
          received_status?: Database["public"]["Enums"]["acquisition_received_status"]
          reference?: string | null
          shipping_intl?: number
          total_cost?: number | null
          updated_at?: string
        }
        Update: {
          buyer_premium?: number
          card_fee?: number
          courier_ve?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customs_ve?: number
          deleted_at?: string | null
          due_at?: string | null
          fx_rate?: number | null
          fx_rate_source?: Database["public"]["Enums"]["fx_source"] | null
          hammer_total?: number
          id?: string
          notes?: string | null
          other_costs?: number
          payment_status?: Database["public"]["Enums"]["acquisition_payment_status"]
          platform?: Database["public"]["Enums"]["acquisition_platform"]
          purchased_at?: string
          received_status?: Database["public"]["Enums"]["acquisition_received_status"]
          reference?: string | null
          shipping_intl?: number
          total_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      breaks: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          notes: string | null
          opened_at: string
          platform: Database["public"]["Enums"]["sales_channel"] | null
          revenue_from_spots: number
          source_item_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          platform?: Database["public"]["Enums"]["sales_channel"] | null
          revenue_from_spots?: number
          source_item_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          platform?: Database["public"]["Enums"]["sales_channel"] | null
          revenue_from_spots?: number
          source_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "breaks_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breaks_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      consignment_agreements: {
        Row: {
          agreed_min_price: number | null
          commission_pct: number | null
          consignor_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          item_id: string
          notes: string | null
          received_at: string
          return_deadline: string | null
          status: Database["public"]["Enums"]["consignment_agreement_status"]
          updated_at: string
        }
        Insert: {
          agreed_min_price?: number | null
          commission_pct?: number | null
          consignor_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          item_id: string
          notes?: string | null
          received_at?: string
          return_deadline?: string | null
          status?: Database["public"]["Enums"]["consignment_agreement_status"]
          updated_at?: string
        }
        Update: {
          agreed_min_price?: number | null
          commission_pct?: number | null
          consignor_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          received_at?: string
          return_deadline?: string | null
          status?: Database["public"]["Enums"]["consignment_agreement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consignment_agreements_consignor_id_fkey"
            columns: ["consignor_id"]
            isOneToOne: false
            referencedRelation: "consignors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_agreements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_agreements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      consignor_payouts: {
        Row: {
          commission_amount: number
          commission_pct: number
          consignor_id: string
          created_at: string
          created_by: string | null
          id: string
          net_to_consignor: number | null
          notes: string | null
          order_line_id: string
          paid_at: string | null
          sale_price: number
          status: Database["public"]["Enums"]["consignor_payout_status"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          commission_amount: number
          commission_pct: number
          consignor_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          net_to_consignor?: number | null
          notes?: string | null
          order_line_id: string
          paid_at?: string | null
          sale_price: number
          status?: Database["public"]["Enums"]["consignor_payout_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          commission_amount?: number
          commission_pct?: number
          consignor_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          net_to_consignor?: number | null
          notes?: string | null
          order_line_id?: string
          paid_at?: string | null
          sale_price?: number
          status?: Database["public"]["Enums"]["consignor_payout_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consignor_payouts_consignor_id_fkey"
            columns: ["consignor_id"]
            isOneToOne: false
            referencedRelation: "consignors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignor_payouts_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: true
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignor_payouts_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: true
            referencedRelation: "order_lines_with_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignor_payouts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      consignors: {
        Row: {
          agreement_url: string | null
          city: string | null
          commission_pct: number
          country: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_name: string
          email: string | null
          id: string
          id_document: string | null
          notes: string | null
          payout_details: Json
          payout_method: Database["public"]["Enums"]["payment_method"] | null
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agreement_url?: string | null
          city?: string | null
          commission_pct?: number
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name: string
          email?: string | null
          id?: string
          id_document?: string | null
          notes?: string | null
          payout_details?: Json
          payout_method?: Database["public"]["Enums"]["payment_method"] | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agreement_url?: string | null
          city?: string | null
          commission_pct?: number
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string
          email?: string | null
          id?: string
          id_document?: string | null
          notes?: string | null
          payout_details?: Json
          payout_method?: Database["public"]["Enums"]["payment_method"] | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_name: string
          email: string | null
          id: string
          id_document: string | null
          is_wholesale: boolean
          notes: string | null
          phone: string | null
          tags: string[]
          updated_at: string
          wishlist: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name: string
          email?: string | null
          id?: string
          id_document?: string | null
          is_wholesale?: boolean
          notes?: string | null
          phone?: string | null
          tags?: string[]
          updated_at?: string
          wishlist?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string
          email?: string | null
          id?: string
          id_document?: string | null
          is_wholesale?: boolean
          notes?: string | null
          phone?: string | null
          tags?: string[]
          updated_at?: string
          wishlist?: string | null
        }
        Relationships: []
      }
      document_counters: {
        Row: {
          last_value: number
          prefix: string
          year: number
        }
        Insert: {
          last_value?: number
          prefix: string
          year: number
        }
        Update: {
          last_value?: number
          prefix?: string
          year?: number
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          rate: number
          rate_date: string
          source: Database["public"]["Enums"]["fx_source"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          rate: number
          rate_date: string
          source: Database["public"]["Enums"]["fx_source"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          rate?: number
          rate_date?: string
          source?: Database["public"]["Enums"]["fx_source"]
        }
        Relationships: []
      }
      item_costs: {
        Row: {
          allocated_cost: number
          cost_basis: number | null
          created_at: string
          created_by: string | null
          grading_cost: number
          item_id: string
          notes: string | null
          other_cost: number
          updated_at: string
        }
        Insert: {
          allocated_cost?: number
          cost_basis?: number | null
          created_at?: string
          created_by?: string | null
          grading_cost?: number
          item_id: string
          notes?: string | null
          other_cost?: number
          updated_at?: string
        }
        Update: {
          allocated_cost?: number
          cost_basis?: number | null
          created_at?: string
          created_by?: string | null
          grading_cost?: number
          item_id?: string
          notes?: string | null
          other_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_costs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_costs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      item_images: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          kind: Database["public"]["Enums"]["image_kind"]
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          kind?: Database["public"]["Enums"]["image_kind"]
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          kind?: Database["public"]["Enums"]["image_kind"]
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_images_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_images_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      item_valuations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          note: string | null
          source: Database["public"]["Enums"]["valuation_source"]
          source_url: string | null
          value: number
          valued_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          note?: string | null
          source?: Database["public"]["Enums"]["valuation_source"]
          source_url?: string | null
          value: number
          valued_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          note?: string | null
          source?: Database["public"]["Enums"]["valuation_source"]
          source_url?: string | null
          value?: number
          valued_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_valuations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_valuations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          acquisition_id: string | null
          brand: string | null
          card_number: string | null
          category: Database["public"]["Enums"]["item_category"]
          cert_number: string | null
          consignor_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description_en: string | null
          description_es: string | null
          grade: number | null
          grade_label: string | null
          grading_company: Database["public"]["Enums"]["grading_company"]
          id: string
          is_autograph: boolean
          is_patch: boolean
          is_published: boolean
          is_rookie: boolean
          language: string | null
          list_price: number | null
          location: string | null
          market_value: number | null
          market_value_at: string | null
          market_value_source: string | null
          min_price: number | null
          owner_type: Database["public"]["Enums"]["owner_type"]
          parent_item_id: string | null
          player_or_character: string | null
          quantity: number
          raw_condition: Database["public"]["Enums"]["raw_condition"] | null
          search_vector: unknown
          serial_numbered: string | null
          set_name: string | null
          sku: string
          slug: string | null
          sport_or_game: string | null
          status: Database["public"]["Enums"]["item_status"]
          tags: string[]
          type: Database["public"]["Enums"]["item_type"]
          updated_at: string
          variant: string | null
          year: number | null
        }
        Insert: {
          acquisition_id?: string | null
          brand?: string | null
          card_number?: string | null
          category: Database["public"]["Enums"]["item_category"]
          cert_number?: string | null
          consignor_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description_en?: string | null
          description_es?: string | null
          grade?: number | null
          grade_label?: string | null
          grading_company?: Database["public"]["Enums"]["grading_company"]
          id?: string
          is_autograph?: boolean
          is_patch?: boolean
          is_published?: boolean
          is_rookie?: boolean
          language?: string | null
          list_price?: number | null
          location?: string | null
          market_value?: number | null
          market_value_at?: string | null
          market_value_source?: string | null
          min_price?: number | null
          owner_type?: Database["public"]["Enums"]["owner_type"]
          parent_item_id?: string | null
          player_or_character?: string | null
          quantity?: number
          raw_condition?: Database["public"]["Enums"]["raw_condition"] | null
          search_vector?: unknown
          serial_numbered?: string | null
          set_name?: string | null
          sku?: string
          slug?: string | null
          sport_or_game?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          tags?: string[]
          type: Database["public"]["Enums"]["item_type"]
          updated_at?: string
          variant?: string | null
          year?: number | null
        }
        Update: {
          acquisition_id?: string | null
          brand?: string | null
          card_number?: string | null
          category?: Database["public"]["Enums"]["item_category"]
          cert_number?: string | null
          consignor_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description_en?: string | null
          description_es?: string | null
          grade?: number | null
          grade_label?: string | null
          grading_company?: Database["public"]["Enums"]["grading_company"]
          id?: string
          is_autograph?: boolean
          is_patch?: boolean
          is_published?: boolean
          is_rookie?: boolean
          language?: string | null
          list_price?: number | null
          location?: string | null
          market_value?: number | null
          market_value_at?: string | null
          market_value_source?: string | null
          min_price?: number | null
          owner_type?: Database["public"]["Enums"]["owner_type"]
          parent_item_id?: string | null
          player_or_character?: string | null
          quantity?: number
          raw_condition?: Database["public"]["Enums"]["raw_condition"] | null
          search_vector?: unknown
          serial_numbered?: string | null
          set_name?: string | null
          sku?: string
          slug?: string | null
          sport_or_game?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          tags?: string[]
          type?: Database["public"]["Enums"]["item_type"]
          updated_at?: string
          variant?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_acquisition_id_fkey"
            columns: ["acquisition_id"]
            isOneToOne: false
            referencedRelation: "acquisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_consignor_id_fkey"
            columns: ["consignor_id"]
            isOneToOne: false
            referencedRelation: "consignors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          reference_id: string | null
          reference_type: string | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      order_line_costs: {
        Row: {
          allocated_order_cost: number
          cost_basis_snapshot: number
          created_at: string
          created_by: string | null
          gross_margin: number
          order_line_id: string
          updated_at: string
        }
        Insert: {
          allocated_order_cost?: number
          cost_basis_snapshot?: number
          created_at?: string
          created_by?: string | null
          gross_margin?: number
          order_line_id: string
          updated_at?: string
        }
        Update: {
          allocated_order_cost?: number
          cost_basis_snapshot?: number
          created_at?: string
          created_by?: string | null
          gross_margin?: number
          order_line_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_line_costs_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: true
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_costs_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: true
            referencedRelation: "order_lines_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          order_id: string
          quantity: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          order_id: string
          quantity?: number
          unit_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          order_id?: string
          quantity?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["order_id"]
          },
        ]
      }
      orders: {
        Row: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          deleted_at: string | null
          delivered_at: string | null
          discount: number
          due_at: string | null
          fx_rate: number | null
          fx_rate_source: Database["public"]["Enums"]["fx_source"] | null
          id: string
          net_proceeds: number | null
          notes: string | null
          order_number: string
          paid_at: string | null
          payment_fee: number
          placed_at: string
          platform_fee: number
          shipped_at: string | null
          shipping_charged: number
          shipping_cost_real: number
          shipping_method: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number | null
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["sales_channel"]
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          discount?: number
          due_at?: string | null
          fx_rate?: number | null
          fx_rate_source?: Database["public"]["Enums"]["fx_source"] | null
          id?: string
          net_proceeds?: number | null
          notes?: string | null
          order_number?: string
          paid_at?: string | null
          payment_fee?: number
          placed_at?: string
          platform_fee?: number
          shipped_at?: string | null
          shipping_charged?: number
          shipping_cost_real?: number
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number | null
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["sales_channel"]
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          discount?: number
          due_at?: string | null
          fx_rate?: number | null
          fx_rate_source?: Database["public"]["Enums"]["fx_source"] | null
          id?: string
          net_proceeds?: number | null
          notes?: string | null
          order_number?: string
          paid_at?: string | null
          payment_fee?: number
          placed_at?: string
          platform_fee?: number
          shipped_at?: string | null
          shipping_charged?: number
          shipping_cost_real?: number
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number | null
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          account_id: string | null
          acquisition_id: string | null
          amount: number
          amount_usd_equivalent: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          direction: Database["public"]["Enums"]["payment_direction"]
          fx_rate: number | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          order_id: string | null
          paid_at: string
          proof_url: string | null
          reference: string | null
          status: Database["public"]["Enums"]["payment_verification_status"]
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          account_id?: string | null
          acquisition_id?: string | null
          amount: number
          amount_usd_equivalent: number
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          direction: Database["public"]["Enums"]["payment_direction"]
          fx_rate?: number | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          order_id?: string | null
          paid_at?: string
          proof_url?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_verification_status"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          account_id?: string | null
          acquisition_id?: string | null
          amount?: number
          amount_usd_equivalent?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          direction?: Database["public"]["Enums"]["payment_direction"]
          fx_rate?: number | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          order_id?: string | null
          paid_at?: string
          proof_url?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_verification_status"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_acquisition_id_fkey"
            columns: ["acquisition_id"]
            isOneToOne: false
            referencedRelation: "acquisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["order_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          amount_usd: number
          category_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string | null
          fx_rate: number | null
          id: string
          occurred_at: string
          reconciled: boolean
          reference_id: string | null
          reference_type: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          amount_usd: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          description?: string | null
          fx_rate?: number | null
          id?: string
          occurred_at?: string
          reconciled?: boolean
          reference_id?: string | null
          reference_type?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          amount_usd?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string | null
          fx_rate?: number | null
          id?: string
          occurred_at?: string
          reconciled?: boolean
          reference_id?: string | null
          reference_type?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      items_with_costs: {
        Row: {
          acquisition_id: string | null
          allocated_cost: number | null
          brand: string | null
          card_number: string | null
          category: Database["public"]["Enums"]["item_category"] | null
          cert_number: string | null
          consignor_id: string | null
          cost_basis: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description_en: string | null
          description_es: string | null
          grade: number | null
          grade_label: string | null
          grading_company: Database["public"]["Enums"]["grading_company"] | null
          grading_cost: number | null
          id: string | null
          is_autograph: boolean | null
          is_patch: boolean | null
          is_published: boolean | null
          is_rookie: boolean | null
          language: string | null
          list_price: number | null
          location: string | null
          market_value: number | null
          market_value_at: string | null
          market_value_source: string | null
          min_price: number | null
          other_cost: number | null
          owner_type: Database["public"]["Enums"]["owner_type"] | null
          parent_item_id: string | null
          player_or_character: string | null
          quantity: number | null
          raw_condition: Database["public"]["Enums"]["raw_condition"] | null
          search_vector: unknown
          serial_numbered: string | null
          set_name: string | null
          sku: string | null
          slug: string | null
          sport_or_game: string | null
          status: Database["public"]["Enums"]["item_status"] | null
          tags: string[] | null
          type: Database["public"]["Enums"]["item_type"] | null
          unrealized_gain: number | null
          updated_at: string | null
          variant: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_acquisition_id_fkey"
            columns: ["acquisition_id"]
            isOneToOne: false
            referencedRelation: "acquisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_consignor_id_fkey"
            columns: ["consignor_id"]
            isOneToOne: false
            referencedRelation: "consignors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines_with_costs: {
        Row: {
          allocated_order_cost: number | null
          cost_basis_snapshot: number | null
          created_at: string | null
          created_by: string | null
          gross_margin: number | null
          id: string | null
          item_id: string | null
          order_id: string | null
          quantity: number | null
          unit_price: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_with_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["order_id"]
          },
        ]
      }
      payables: {
        Row: {
          balance_usd: number | null
          currency: string | null
          days_overdue: number | null
          due_at: string | null
          kind: string | null
          label: string | null
          paid_usd: number | null
          reference_id: string | null
          total_usd: number | null
        }
        Relationships: []
      }
      receivables: {
        Row: {
          balance_usd: number | null
          channel: Database["public"]["Enums"]["sales_channel"] | null
          currency: string | null
          customer_id: string | null
          days_overdue: number | null
          due_at: string | null
          order_id: string | null
          order_number: string | null
          paid_usd: number | null
          placed_at: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          total: number | null
          total_usd: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_admin: { Args: never; Returns: boolean }
      current_consignor_id: { Args: never; Returns: string }
      current_fx_rate: {
        Args: { p_source?: Database["public"]["Enums"]["fx_source"] }
        Returns: number
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff_or_above: { Args: never; Returns: boolean }
      next_document_number: { Args: { p_prefix: string }; Returns: string }
    }
    Enums: {
      account_type:
        | "bank_ve"
        | "bank_us"
        | "zelle"
        | "binance"
        | "cash"
        | "platform_balance"
        | "card"
      acquisition_payment_status: "pending" | "partial" | "paid"
      acquisition_platform:
        | "alt"
        | "goldin"
        | "ebay"
        | "whatnot"
        | "fanatics"
        | "pwcc"
        | "private"
        | "retail"
        | "other"
      acquisition_received_status:
        | "pending"
        | "in_transit"
        | "received"
        | "partial"
      audit_action: "insert" | "update" | "delete"
      consignment_agreement_status: "active" | "sold" | "returned" | "expired"
      consignor_payout_status: "pending" | "paid"
      fx_source: "bcv" | "binance" | "manual"
      grading_company: "PSA" | "BGS" | "CGC" | "SGC" | "TAG" | "none"
      image_kind: "front" | "back" | "cert" | "detail"
      item_category: "sports" | "tcg" | "other"
      item_status:
        | "incoming"
        | "in_stock"
        | "listed"
        | "reserved"
        | "sold"
        | "consigned_out"
        | "returned"
        | "lost"
        | "consumed"
      item_type:
        | "graded_card"
        | "raw_card"
        | "sealed_box"
        | "sealed_pack"
        | "lot"
        | "supply"
      order_status:
        | "draft"
        | "pending_payment"
        | "paid"
        | "packing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      owner_type: "own" | "consignment"
      payment_direction: "in" | "out"
      payment_method:
        | "zelle"
        | "pago_movil"
        | "transfer_bs"
        | "binance"
        | "cash_usd"
        | "cash_bs"
        | "stripe"
        | "paypal"
        | "card"
        | "other"
      payment_verification_status:
        | "pending_verification"
        | "verified"
        | "rejected"
      raw_condition: "NM" | "LP" | "MP" | "HP" | "DMG"
      sales_channel:
        | "store"
        | "whatnot"
        | "instagram"
        | "tiktok"
        | "ebay"
        | "in_person"
        | "other"
      transaction_type:
        | "sale"
        | "purchase"
        | "expense"
        | "transfer"
        | "fx_exchange"
        | "adjustment"
        | "consignor_payout"
      user_role: "owner" | "admin" | "staff" | "viewer" | "consignor"
      valuation_source:
        | "manual"
        | "psa"
        | "ebay_sold"
        | "130point"
        | "tcgplayer"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_type: [
        "bank_ve",
        "bank_us",
        "zelle",
        "binance",
        "cash",
        "platform_balance",
        "card",
      ],
      acquisition_payment_status: ["pending", "partial", "paid"],
      acquisition_platform: [
        "alt",
        "goldin",
        "ebay",
        "whatnot",
        "fanatics",
        "pwcc",
        "private",
        "retail",
        "other",
      ],
      acquisition_received_status: [
        "pending",
        "in_transit",
        "received",
        "partial",
      ],
      audit_action: ["insert", "update", "delete"],
      consignment_agreement_status: ["active", "sold", "returned", "expired"],
      consignor_payout_status: ["pending", "paid"],
      fx_source: ["bcv", "binance", "manual"],
      grading_company: ["PSA", "BGS", "CGC", "SGC", "TAG", "none"],
      image_kind: ["front", "back", "cert", "detail"],
      item_category: ["sports", "tcg", "other"],
      item_status: [
        "incoming",
        "in_stock",
        "listed",
        "reserved",
        "sold",
        "consigned_out",
        "returned",
        "lost",
        "consumed",
      ],
      item_type: [
        "graded_card",
        "raw_card",
        "sealed_box",
        "sealed_pack",
        "lot",
        "supply",
      ],
      order_status: [
        "draft",
        "pending_payment",
        "paid",
        "packing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      owner_type: ["own", "consignment"],
      payment_direction: ["in", "out"],
      payment_method: [
        "zelle",
        "pago_movil",
        "transfer_bs",
        "binance",
        "cash_usd",
        "cash_bs",
        "stripe",
        "paypal",
        "card",
        "other",
      ],
      payment_verification_status: [
        "pending_verification",
        "verified",
        "rejected",
      ],
      raw_condition: ["NM", "LP", "MP", "HP", "DMG"],
      sales_channel: [
        "store",
        "whatnot",
        "instagram",
        "tiktok",
        "ebay",
        "in_person",
        "other",
      ],
      transaction_type: [
        "sale",
        "purchase",
        "expense",
        "transfer",
        "fx_exchange",
        "adjustment",
        "consignor_payout",
      ],
      user_role: ["owner", "admin", "staff", "viewer", "consignor"],
      valuation_source: [
        "manual",
        "psa",
        "ebay_sold",
        "130point",
        "tcgplayer",
        "other",
      ],
    },
  },
} as const
