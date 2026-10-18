
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
                },"audit_log": {
                  Row: {
                    "action": string,"actor_email": string,"actor_id": string,"after": Json | null,"before": Json | null,"created_at": string,"id": string,"organization_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_email": string,"actor_id": string,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: string,"organization_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_email"?: string,"actor_id"?: string,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: string,"organization_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"branches": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"slug": string,"slug_aliases": (string)[],"waiter_call_cooldown_seconds": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"slug": string,"slug_aliases"?: (string)[],"waiter_call_cooldown_seconds"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"slug"?: string,"slug_aliases"?: (string)[],"waiter_call_cooldown_seconds"?: number
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
                },"option_groups": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"max_choices": number,"min_choices": number,"name": string,"organization_id": string,"product_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"max_choices"?: number,"min_choices"?: number,"name": string,"organization_id": string,"product_id": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"max_choices"?: number,"min_choices"?: number,"name"?: string,"organization_id"?: string,"product_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "option_groups_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "option_groups_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"options": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"price_delta_cents": number,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"price_delta_cents"?: number,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"price_delta_cents"?: number,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "options_group_id_organization_id_fkey"
      columns: ["group_id","organization_id"]
isOneToOne: false
      referencedRelation: "option_groups"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "options_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"logo_path": string | null,"menu_palette": string,"name": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"logo_path"?: string | null,"menu_palette"?: string,"name": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"logo_path"?: string | null,"menu_palette"?: string,"name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"billing_cycle": string,"covers_until": string,"created_at": string,"currency": string,"id": string,"method": string,"organization_id": string,"paid_on": string,"plan_code": string,"previous_period_end": string,"reference": string | null,"registered_by": string,"subscription_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"billing_cycle": string,"covers_until": string,"created_at"?: string,"currency": string,"id"?: string,"method": string,"organization_id": string,"paid_on": string,"plan_code": string,"previous_period_end": string,"reference"?: string | null,"registered_by": string,"subscription_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"billing_cycle"?: string,"covers_until"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"method"?: string,"organization_id"?: string,"paid_on"?: string,"plan_code"?: string,"previous_period_end"?: string,"reference"?: string | null,"registered_by"?: string,"subscription_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_subscription_id_fkey"
      columns: ["subscription_id"]
isOneToOne: false
      referencedRelation: "subscriptions"
      referencedColumns: ["id"]
    }
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
                },"platform_admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
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
                },"product_availability": {
                  Row: {
                    "branch_id": string,"is_available": boolean,"organization_id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"is_available"?: boolean,"organization_id": string,"product_id": string
                  }
                  Update: {
                    "branch_id"?: string,"is_available"?: boolean,"organization_id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_availability_branch_id_organization_id_fkey"
      columns: ["branch_id","organization_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "product_availability_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_availability_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category_id": string,"created_at": string,"currency": string,"description": string | null,"dietary_tags": (string)[],"id": string,"image_path": string | null,"is_active": boolean,"name": string,"organization_id": string,"price_cents": number,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"currency"?: string,"description"?: string | null,"dietary_tags"?: (string)[],"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name": string,"organization_id": string,"price_cents": number,"sort_order"?: number
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"currency"?: string,"description"?: string | null,"dietary_tags"?: (string)[],"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"price_cents"?: number,"sort_order"?: number
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
                },"push_subscriptions": {
                  Row: {
                    "auth_secret": string,"created_at": string,"endpoint": string,"id": string,"organization_id": string,"p256dh": string,"registered_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_secret": string,"created_at"?: string,"endpoint": string,"id"?: string,"organization_id": string,"p256dh": string,"registered_at"?: string,"user_id": string
                  }
                  Update: {
                    "auth_secret"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"organization_id"?: string,"p256dh"?: string,"registered_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_subscriptions_user_id_organization_id_fkey"
      columns: ["user_id","organization_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id","organization_id"]
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
                    "billing_cycle": string,"created_at": string,"current_period_end": string | null,"id": string,"notes": string | null,"organization_id": string,"plan_code": string,"suspended_at": string | null,"trial_ends_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_cycle"?: string,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"notes"?: string | null,"organization_id": string,"plan_code": string,"suspended_at"?: string | null,"trial_ends_at"?: string | null
                  }
                  Update: {
                    "billing_cycle"?: string,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"notes"?: string | null,"organization_id"?: string,"plan_code"?: string,"suspended_at"?: string | null,"trial_ends_at"?: string | null
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
                    "branch_id": string,"created_at": string,"id": string,"is_active": boolean,"label": string,"muted_until": string | null,"organization_id": string,"qr_token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label": string,"muted_until"?: string | null,"organization_id": string,"qr_token"?: string
                  }
                  Update: {
                    "branch_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"muted_until"?: string | null,"organization_id"?: string,"qr_token"?: string
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
                },"waiter_calls": {
                  Row: {
                    "attended_at": string | null,"attended_by": string | null,"branch_id": string,"client_key": string | null,"created_at": string,"id": string,"kind": string,"organization_id": string,"status": string,"table_id": string,"visit_started_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attended_at"?: string | null,"attended_by"?: string | null,"branch_id": string,"client_key"?: string | null,"created_at"?: string,"id"?: string,"kind": string,"organization_id": string,"status"?: string,"table_id": string,"visit_started_at"?: string | null
                  }
                  Update: {
                    "attended_at"?: string | null,"attended_by"?: string | null,"branch_id"?: string,"client_key"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"organization_id"?: string,"status"?: string,"table_id"?: string,"visit_started_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "waiter_calls_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waiter_calls_table_id_branch_id_organization_id_fkey"
      columns: ["table_id","branch_id","organization_id"]
isOneToOne: false
      referencedRelation: "tables"
      referencedColumns: ["id","branch_id","organization_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_add_owner":
{ Args: { "p_actor": string,"p_confirmed": boolean,"p_email": string,"p_expected_user"?: string,"p_org": string }; Returns: Json
                           },
"admin_change_plan":
{ Args: { "p_actor": string,"p_billing_cycle": string,"p_org": string,"p_plan": string,"p_reason": string }; Returns: undefined
                           },
"admin_create_organization":
{ Args: { "p_actor": string,"p_billing_cycle": string,"p_branch_name"?: string,"p_branch_slug"?: string,"p_name": string,"p_owner": string,"p_period_end": string,"p_plan": string,"p_slug": string }; Returns: string
                           },
"admin_register_payment":
{ Args: { "p_actor": string,"p_amount_cents": number,"p_covers_until": string,"p_currency": string,"p_method": string,"p_org": string,"p_paid_on": string,"p_reference": string }; Returns: string
                           },
"admin_set_suspension":
{ Args: { "p_actor": string,"p_org": string,"p_reason": string,"p_suspend": boolean }; Returns: undefined
                           },
"create_waiter_call":
{ Args: { "p_client"?: string,"p_kind": string,"p_token": string,"p_visit_started_at"?: string }; Returns: Json
                           },
"drop_push_subscriptions":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"org_entitlements":
{ Args: { "p_org": string }; Returns: Json
                           },
"public_menu_status":
{ Args: { "p_branch_slug": string,"p_org_slug": string }; Returns: string
                           },
"purge_waiter_calls":
{ Args: { "p_batch"?: number,"p_retention"?: string }; Returns: number
                           },
"push_subscription_registered":
{ Args: { "p_endpoint": string,"p_org": string }; Returns: boolean
                           },
"push_targets_for_call":
{ Args: { "p_kind": string,"p_token": string }; Returns: Json
                           },
"register_push_subscription":
{ Args: { "p_auth": string,"p_endpoint": string,"p_org": string,"p_p256dh": string }; Returns: string
                           },
"resolve_table_qr":
{ Args: { "p_token": string }; Returns: Json
                           },
"unregister_push_subscription":
{ Args: { "p_endpoint": string,"p_org"?: string }; Returns: undefined
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
