
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "addons": {
                  Row: {
                    "allowed_plans": (string)[],"base_model_quota": number,"code": string,"created_at": string,"monthly_price_usd_cents": number,"name": string,"pack_monthly_price_usd_cents": number,"pack_size": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_plans": (string)[],"base_model_quota": number,"code": string,"created_at"?: string,"monthly_price_usd_cents": number,"name": string,"pack_monthly_price_usd_cents": number,"pack_size": number
                  }
                  Update: {
                    "allowed_plans"?: (string)[],"base_model_quota"?: number,"code"?: string,"created_at"?: string,"monthly_price_usd_cents"?: number,"name"?: string,"pack_monthly_price_usd_cents"?: number,"pack_size"?: number
                  }
                  Relationships: [
                    
                  ]
                },"branches": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"organization_id": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"organization_id": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "branches_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"plans": {
                  Row: {
                    "code": string,"created_at": string,"features": (string)[],"max_active_products": number | null,"max_branches": number | null,"max_tables_per_branch": number | null,"monthly_price_usd_cents": number,"name": string,"yearly_price_usd_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"features"?: (string)[],"max_active_products"?: number | null,"max_branches"?: number | null,"max_tables_per_branch"?: number | null,"monthly_price_usd_cents": number,"name": string,"yearly_price_usd_cents": number
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"features"?: (string)[],"max_active_products"?: number | null,"max_branches"?: number | null,"max_tables_per_branch"?: number | null,"monthly_price_usd_cents"?: number,"name"?: string,"yearly_price_usd_cents"?: number
                  }
                  Relationships: [

                  ]
                },"price_history": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"id": string,"new_price_cents": number,"old_price_cents": number,"organization_id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_price_cents": number,"old_price_cents": number,"organization_id": string,"product_id": string
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_price_cents"?: number,"old_price_cents"?: number,"organization_id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "price_history_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category_id": string,"created_at": string,"currency": string,"description": string | null,"id": string,"image_path": string | null,"is_active": boolean,"name": string,"organization_id": string,"price_cents": number,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"currency"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name": string,"organization_id": string,"price_cents": number,"sort_order"?: number
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"currency"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"price_cents"?: number,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_organization_id_fkey"
      columns: ["category_id","organization_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "products_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"subscription_addons": {
                  Row: {
                    "addon_code": string,"created_at": string,"ends_at": string | null,"extra_packs": number,"id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "addon_code": string,"created_at"?: string,"ends_at"?: string | null,"extra_packs"?: number,"id"?: string,"organization_id": string
                  }
                  Update: {
                    "addon_code"?: string,"created_at"?: string,"ends_at"?: string | null,"extra_packs"?: number,"id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_addons_addon_code_fkey"
      columns: ["addon_code"]
isOneToOne: false
      referencedRelation: "addons"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "subscription_addons_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "billing_cycle": string,"created_at": string,"current_period_end": string | null,"id": string,"notes": string | null,"organization_id": string,"plan_code": string,"trial_ends_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_cycle"?: string,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"notes"?: string | null,"organization_id": string,"plan_code": string,"trial_ends_at"?: string | null
                  }
                  Update: {
                    "billing_cycle"?: string,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"notes"?: string | null,"organization_id"?: string,"plan_code"?: string,"trial_ends_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_plan_code_fkey"
      columns: ["plan_code"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["code"]
    }
                  ]
                },"tables": {
                  Row: {
                    "branch_id": string,"created_at": string,"id": string,"is_active": boolean,"label": string,"organization_id": string,"qr_token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label": string,"organization_id": string,"qr_token"?: string
                  }
                  Update: {
                    "branch_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"organization_id"?: string,"qr_token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tables_branch_id_organization_id_fkey"
      columns: ["branch_id","organization_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "tables_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "org_entitlements":
{ Args: { "p_org": string }; Returns: Json
                           },
"public_menu_status":
{ Args: { "p_branch_slug": string,"p_org_slug": string }; Returns: string
                           },
"resolve_table_qr":
{ Args: { "p_token": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
