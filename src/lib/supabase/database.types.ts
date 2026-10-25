
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
                    "allowed_plans": (string)[],"base_model_quota": number,"code": string,"created_at": string,"currency": string | null,"grants_limit": string | null,"max_packs": number | null,"monthly_price_usd_cents": number,"name": string,"pack_monthly_price_usd_cents": number,"pack_size": number,"price_cents": number | null,"quota_per_pack": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_plans": (string)[],"base_model_quota": number,"code": string,"created_at"?: string,"currency"?: string | null,"grants_limit"?: string | null,"max_packs"?: number | null,"monthly_price_usd_cents": number,"name": string,"pack_monthly_price_usd_cents": number,"pack_size": number,"price_cents"?: number | null,"quota_per_pack"?: number | null
                  }
                  Update: {
                    "allowed_plans"?: (string)[],"base_model_quota"?: number,"code"?: string,"created_at"?: string,"currency"?: string | null,"grants_limit"?: string | null,"max_packs"?: number | null,"monthly_price_usd_cents"?: number,"name"?: string,"pack_monthly_price_usd_cents"?: number,"pack_size"?: number,"price_cents"?: number | null,"quota_per_pack"?: number | null
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
                    "created_at": string,"google_review_url": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string,"qr_reset_after": string,"qr_reset_times": (string)[],"slug": string,"slug_aliases": (string)[],"timezone": string,"waiter_call_cooldown_seconds": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"google_review_url"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"qr_reset_after"?: string,"qr_reset_times"?: (string)[],"slug": string,"slug_aliases"?: (string)[],"timezone"?: string,"waiter_call_cooldown_seconds"?: number
                  }
                  Update: {
                    "created_at"?: string,"google_review_url"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"qr_reset_after"?: string,"qr_reset_times"?: (string)[],"slug"?: string,"slug_aliases"?: (string)[],"timezone"?: string,"waiter_call_cooldown_seconds"?: number
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
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"sort_order": number,"translations": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"sort_order"?: number,"translations"?: NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"sort_order"?: number,"translations"?: NonNullable<Json>
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
                },"dish_view_counts": {
                  Row: {
                    "branch_id": string,"day": string,"organization_id": string,"product_id": string,"views": number
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"day": string,"organization_id": string,"product_id": string,"views": number
                  }
                  Update: {
                    "branch_id"?: string,"day"?: string,"organization_id"?: string,"product_id"?: string,"views"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "dish_view_counts_branch_id_fkey"
      columns: ["branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dish_view_counts_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dish_view_counts_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"member_branch_views": {
                  Row: {
                    "branch_ids": (string)[],"organization_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_ids"?: (string)[],"organization_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "branch_ids"?: (string)[],"organization_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_branch_views_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_branch_views_user_id_organization_id_fkey"
      columns: ["user_id","organization_id"]
isOneToOne: true
      referencedRelation: "memberships"
      referencedColumns: ["user_id","organization_id"]
    }
                  ]
                },"member_guide_dismissals": {
                  Row: {
                    "dismissed_at": string,"organization_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "dismissed_at"?: string,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "dismissed_at"?: string,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_guide_dismissals_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_guide_dismissals_user_id_organization_id_fkey"
      columns: ["user_id","organization_id"]
isOneToOne: true
      referencedRelation: "memberships"
      referencedColumns: ["user_id","organization_id"]
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
                },"menu_videos": {
                  Row: {
                    "comment_count": number,"created_at": string,"duration_seconds": number | null,"id": string,"like_count": number,"mux_asset_id": string | null,"mux_error": string | null,"mux_playback_id": string | null,"mux_status": string,"mux_upload_id": string | null,"organization_id": string,"product_id": string | null,"sort_order": number,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_count"?: number,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"like_count"?: number,"mux_asset_id"?: string | null,"mux_error"?: string | null,"mux_playback_id"?: string | null,"mux_status"?: string,"mux_upload_id"?: string | null,"organization_id": string,"product_id"?: string | null,"sort_order"?: number,"status"?: string,"title": string
                  }
                  Update: {
                    "comment_count"?: number,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"like_count"?: number,"mux_asset_id"?: string | null,"mux_error"?: string | null,"mux_playback_id"?: string | null,"mux_status"?: string,"mux_upload_id"?: string | null,"organization_id"?: string,"product_id"?: string | null,"sort_order"?: number,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_videos_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "menu_videos_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"option_groups": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"max_choices": number,"min_choices": number,"name": string,"organization_id": string,"product_id": string,"sort_order": number,"translations": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"max_choices"?: number,"min_choices"?: number,"name": string,"organization_id": string,"product_id": string,"sort_order"?: number,"translations"?: NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"max_choices"?: number,"min_choices"?: number,"name"?: string,"organization_id"?: string,"product_id"?: string,"sort_order"?: number,"translations"?: NonNullable<Json>
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
                    "created_at": string,"group_id": string,"id": string,"is_active": boolean,"name": string,"organization_id": string,"price_delta_cents": number,"sort_order": number,"translations": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"price_delta_cents"?: number,"sort_order"?: number,"translations"?: NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"price_delta_cents"?: number,"sort_order"?: number,"translations"?: NonNullable<Json>
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
                },"order_events": {
                  Row: {
                    "actor_id": string | null,"detail": NonNullable<Json>,"event": string,"id": string,"item_id": string | null,"occurred_at": string,"order_id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"detail"?: NonNullable<Json>,"event": string,"id"?: string,"item_id"?: string | null,"occurred_at"?: string,"order_id": string,"organization_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"detail"?: NonNullable<Json>,"event"?: string,"id"?: string,"item_id"?: string | null,"occurred_at"?: string,"order_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"order_item_options": {
                  Row: {
                    "created_at": string,"group_id": string | null,"group_name": string,"id": string,"option_id": string | null,"option_name": string,"order_item_id": string,"organization_id": string,"price_delta_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id"?: string | null,"group_name": string,"id"?: string,"option_id"?: string | null,"option_name": string,"order_item_id": string,"organization_id": string,"price_delta_cents": number
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string | null,"group_name"?: string,"id"?: string,"option_id"?: string | null,"option_name"?: string,"order_item_id"?: string,"organization_id"?: string,"price_delta_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_item_options_option_id_organization_id_fkey"
      columns: ["option_id","organization_id"]
isOneToOne: false
      referencedRelation: "options"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "order_item_options_order_item_id_organization_id_fkey"
      columns: ["order_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "base_price_cents": number,"cancel_reason": string | null,"client_key": string,"created_at": string,"created_by": string | null,"id": string,"note": string | null,"options_cents": number,"order_id": string,"organization_id": string,"product_id": string | null,"product_name": string,"promotion_id": string | null,"promotion_name": string | null,"quantity": number,"request_hash": string,"status": string,"unit_price_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "base_price_cents": number,"cancel_reason"?: string | null,"client_key": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"options_cents"?: number,"order_id": string,"organization_id": string,"product_id"?: string | null,"product_name": string,"promotion_id"?: string | null,"promotion_name"?: string | null,"quantity": number,"request_hash": string,"status"?: string,"unit_price_cents": number
                  }
                  Update: {
                    "base_price_cents"?: number,"cancel_reason"?: string | null,"client_key"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"options_cents"?: number,"order_id"?: string,"organization_id"?: string,"product_id"?: string | null,"product_name"?: string,"promotion_id"?: string | null,"promotion_name"?: string | null,"quantity"?: number,"request_hash"?: string,"status"?: string,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_organization_id_fkey"
      columns: ["order_id","organization_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "order_items_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "branch_id": string,"closed_at": string | null,"closed_by": string | null,"id": string,"opened_at": string,"opened_by": string | null,"organization_id": string,"status": string,"table_id": string | null,"table_label": string,"void_reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"closed_at"?: string | null,"closed_by"?: string | null,"id"?: string,"opened_at"?: string,"opened_by"?: string | null,"organization_id": string,"status"?: string,"table_id"?: string | null,"table_label": string,"void_reason"?: string | null
                  }
                  Update: {
                    "branch_id"?: string,"closed_at"?: string | null,"closed_by"?: string | null,"id"?: string,"opened_at"?: string,"opened_by"?: string | null,"organization_id"?: string,"status"?: string,"table_id"?: string | null,"table_label"?: string,"void_reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_branch_id_organization_id_fkey"
      columns: ["branch_id","organization_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "orders_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_table_id_branch_id_organization_id_fkey"
      columns: ["table_id","branch_id","organization_id"]
isOneToOne: false
      referencedRelation: "tables"
      referencedColumns: ["id","branch_id","organization_id"]
    }
                  ]
                },"organization_feature_previews": {
                  Row: {
                    "created_at": string,"ends_at": string,"feature": string,"organization_id": string,"reason": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at": string,"feature": string,"organization_id": string,"reason": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string,"feature"?: string,"organization_id"?: string,"reason"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_feature_previews_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"logo_path": string | null,"menu_layout": string,"menu_palette": string,"menu_theme": string,"menu_theme_from": string | null,"menu_theme_until": string | null,"name": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"logo_path"?: string | null,"menu_layout"?: string,"menu_palette"?: string,"menu_theme"?: string,"menu_theme_from"?: string | null,"menu_theme_until"?: string | null,"name": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"logo_path"?: string | null,"menu_layout"?: string,"menu_palette"?: string,"menu_theme"?: string,"menu_theme_from"?: string | null,"menu_theme_until"?: string | null,"name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payment_voids": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"payment_id": string,"period_end_after": string,"period_end_before": string,"reason": string,"subscription_id": string,"voided_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"payment_id": string,"period_end_after": string,"period_end_before": string,"reason": string,"subscription_id": string,"voided_by": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"payment_id"?: string,"period_end_after"?: string,"period_end_before"?: string,"reason"?: string,"subscription_id"?: string,"voided_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_voids_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
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
                    
                  ]
                },"plans": {
                  Row: {
                    "code": string,"created_at": string,"features": (string)[],"max_active_products": number | null,"max_branches": number | null,"max_tables_per_branch": number | null,"max_videos_published": number | null,"monthly_price_usd_cents": number,"name": string,"yearly_price_usd_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"features"?: (string)[],"max_active_products"?: number | null,"max_branches"?: number | null,"max_tables_per_branch"?: number | null,"max_videos_published"?: number | null,"monthly_price_usd_cents": number,"name": string,"yearly_price_usd_cents": number
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"features"?: (string)[],"max_active_products"?: number | null,"max_branches"?: number | null,"max_tables_per_branch"?: number | null,"max_videos_published"?: number | null,"monthly_price_usd_cents"?: number,"name"?: string,"yearly_price_usd_cents"?: number
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
                    "branch_id": string | null,"changed_at": string,"changed_by": string | null,"id": string,"new_price_cents": number,"old_price_cents": number,"organization_id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_price_cents": number,"old_price_cents": number,"organization_id": string,"product_id": string
                  }
                  Update: {
                    "branch_id"?: string | null,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_price_cents"?: number,"old_price_cents"?: number,"organization_id"?: string,"product_id"?: string
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
                    "branch_id": string,"is_available": boolean,"is_visible": boolean,"organization_id": string,"price_cents": number | null,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"is_available"?: boolean,"is_visible"?: boolean,"organization_id": string,"price_cents"?: number | null,"product_id": string
                  }
                  Update: {
                    "branch_id"?: string,"is_available"?: boolean,"is_visible"?: boolean,"organization_id"?: string,"price_cents"?: number | null,"product_id"?: string
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
                    "category_id": string,"created_at": string,"currency": string,"description": string | null,"dietary_tags": (string)[],"id": string,"image_path": string | null,"is_active": boolean,"name": string,"organization_id": string,"price_cents": number,"sort_order": number,"translations": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"currency"?: string,"description"?: string | null,"dietary_tags"?: (string)[],"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name": string,"organization_id": string,"price_cents": number,"sort_order"?: number,"translations"?: NonNullable<Json>
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"currency"?: string,"description"?: string | null,"dietary_tags"?: (string)[],"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"price_cents"?: number,"sort_order"?: number,"translations"?: NonNullable<Json>
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
                },"promotion_branches": {
                  Row: {
                    "branch_id": string,"organization_id": string,"promotion_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"organization_id": string,"promotion_id": string
                  }
                  Update: {
                    "branch_id"?: string,"organization_id"?: string,"promotion_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_branches_branch_id_organization_id_fkey"
      columns: ["branch_id","organization_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "promotion_branches_promotion_id_organization_id_fkey"
      columns: ["promotion_id","organization_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"promotion_history": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"event": string,"id": string,"organization_id": string,"promotion_id": string,"snapshot": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"event": string,"id"?: string,"organization_id": string,"promotion_id": string,"snapshot": NonNullable<Json>
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"event"?: string,"id"?: string,"organization_id"?: string,"promotion_id"?: string,"snapshot"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_history_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"promotion_targets": {
                  Row: {
                    "category_id": string | null,"id": string,"organization_id": string,"product_id": string | null,"promotion_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"id"?: string,"organization_id": string,"product_id"?: string | null,"promotion_id": string
                  }
                  Update: {
                    "category_id"?: string | null,"id"?: string,"organization_id"?: string,"product_id"?: string | null,"promotion_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_targets_category_id_organization_id_fkey"
      columns: ["category_id","organization_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "promotion_targets_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "promotion_targets_promotion_id_organization_id_fkey"
      columns: ["promotion_id","organization_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"promotions": {
                  Row: {
                    "all_branches": boolean,"created_at": string,"discount_type": string,"discount_value": number,"end_minute": number,"ends_on": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string,"start_minute": number,"starts_on": string | null,"weekdays_mask": number
                  }
                  ComputedFields: never
                  Insert: {
                    "all_branches"?: boolean,"created_at"?: string,"discount_type": string,"discount_value": number,"end_minute": number,"ends_on"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"start_minute": number,"starts_on"?: string | null,"weekdays_mask": number
                  }
                  Update: {
                    "all_branches"?: boolean,"created_at"?: string,"discount_type"?: string,"discount_value"?: number,"end_minute"?: number,"ends_on"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"start_minute"?: number,"starts_on"?: string | null,"weekdays_mask"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotions_organization_id_fkey"
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
                    "branch_id": string,"created_at": string,"id": string,"is_active": boolean,"label": string,"muted_until": string | null,"organization_id": string,"qr_token": string,"turn_started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label": string,"muted_until"?: string | null,"organization_id": string,"qr_token"?: string,"turn_started_at"?: string
                  }
                  Update: {
                    "branch_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"muted_until"?: string | null,"organization_id"?: string,"qr_token"?: string,"turn_started_at"?: string
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
                },"video_comments": {
                  Row: {
                    "alias": string | null,"body": string,"created_at": string,"id": string,"moderated_at": string | null,"organization_id": string,"rate_key": string | null,"status": string,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alias"?: string | null,"body": string,"created_at"?: string,"id"?: string,"moderated_at"?: string | null,"organization_id": string,"rate_key"?: string | null,"status"?: string,"video_id": string
                  }
                  Update: {
                    "alias"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"moderated_at"?: string | null,"organization_id"?: string,"rate_key"?: string | null,"status"?: string,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_comments_video_id_organization_id_fkey"
      columns: ["video_id","organization_id"]
isOneToOne: false
      referencedRelation: "menu_videos"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"video_likes": {
                  Row: {
                    "created_at": string,"device_key": string,"organization_id": string,"rate_key": string | null,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"device_key": string,"organization_id": string,"rate_key"?: string | null,"video_id": string
                  }
                  Update: {
                    "created_at"?: string,"device_key"?: string,"organization_id"?: string,"rate_key"?: string | null,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_likes_video_id_organization_id_fkey"
      columns: ["video_id","organization_id"]
isOneToOne: false
      referencedRelation: "menu_videos"
      referencedColumns: ["id","organization_id"]
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
            "add_order_item":
{ Args: { "p_branch": string,"p_client_key": string,"p_note"?: string,"p_options"?: (string)[],"p_product": string,"p_quantity": number,"p_table": string }; Returns: Json
                           },
"admin_add_owner":
{ Args: { "p_actor": string,"p_confirmed": boolean,"p_email": string,"p_expected_user"?: string,"p_org": string }; Returns: Json
                           },
"admin_begin_orphan_delete":
{ Args: { "p_actor": string,"p_email": string,"p_reason": string,"p_user": string }; Returns: Json
                           },
"admin_change_plan":
{ Args: { "p_actor": string,"p_billing_cycle": string,"p_org": string,"p_plan": string,"p_reason": string }; Returns: undefined
                           },
"admin_create_organization":
{ Args: { "p_actor": string,"p_billing_cycle": string,"p_branch_name"?: string,"p_branch_slug"?: string,"p_name": string,"p_owner": string,"p_period_end": string,"p_plan": string,"p_slug": string }; Returns: string
                           },
"admin_delete_organization":
{ Args: { "p_actor": string,"p_org": string,"p_reason": string,"p_slug": string }; Returns: Json
                           },
"admin_end_addon":
{ Args: { "p_actor": string,"p_addon": string,"p_org": string,"p_reason": string }; Returns: undefined
                           },
"admin_end_feature_preview":
{ Args: { "p_actor": string,"p_feature": string,"p_org": string,"p_reason": string }; Returns: undefined
                           },
"admin_list_orphan_accounts":
{ Args: { "p_actor": string }; Returns: Json
                           },
"admin_record_account_deleted":
{ Args: { "p_actor": string,"p_reason": string,"p_user": string }; Returns: Json
                           },
"admin_register_payment":
{ Args: { "p_actor": string,"p_amount_cents": number,"p_covers_until": string,"p_currency": string,"p_method": string,"p_org": string,"p_paid_on": string,"p_reference": string }; Returns: string
                           },
"admin_set_addon":
{ Args: { "p_actor": string,"p_addon": string,"p_ends_at": string,"p_extra_packs": number,"p_org": string,"p_reason": string }; Returns: undefined
                           },
"admin_set_extra_branches":
{ Args: { "p_actor": string,"p_deactivate": (string)[],"p_org": string,"p_quantity": number,"p_reason": string }; Returns: undefined
                           },
"admin_set_feature_preview":
{ Args: { "p_actor": string,"p_ends_at": string,"p_feature": string,"p_org": string,"p_reason": string }; Returns: undefined
                           },
"admin_set_organization_active":
{ Args: { "p_active": boolean,"p_actor": string,"p_org": string,"p_reason": string }; Returns: undefined
                           },
"admin_set_suspension":
{ Args: { "p_actor": string,"p_org": string,"p_reason": string,"p_suspend": boolean }; Returns: undefined
                           },
"admin_void_payment":
{ Args: { "p_actor": string,"p_org": string,"p_payment": string,"p_reason": string }; Returns: string
                           },
"close_order":
{ Args: { "p_order": string }; Returns: Json
                           },
"create_product_in_branches":
{ Args: { "p_category": string,"p_description": string,"p_dietary_tags": (string)[],"p_hidden_branches": (string)[],"p_is_active": boolean,"p_name": string,"p_org": string,"p_price_cents": number,"p_sort_order": number }; Returns: string
                           },
"create_waiter_call":
{ Args: { "p_client"?: string,"p_kind": string,"p_token": string,"p_visit_started_at"?: string }; Returns: Json
                           },
"drop_push_subscriptions":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"effective_prices":
{ Args: { "p_at"?: string,"p_branch": string,"p_product"?: string }; Returns: {
              "base_price_cents": number,"discount_type": string,"discount_value": number,"ends_local": string,"price_cents": number,"product_id": string,"promotion_id": string,"promotion_name": string
            }[]
                           },
"get_table_account":
{ Args: { "p_ticket_at": string,"p_token": string }; Returns: Json
                           },
"my_branch_view":
{ Args: { "p_org": string }; Returns: (string)[]
                           },
"my_guide_dismissed":
{ Args: { "p_org": string }; Returns: boolean
                           },
"org_entitlements":
{ Args: { "p_org": string }; Returns: Json
                           },
"owner_account_history":
{ Args: { "p_before"?: string,"p_before_id"?: string,"p_limit"?: number,"p_org": string }; Returns: {
              "action": string,"created_at": string,"detail": Json,"id": string
            }[]
                           },
"owner_calls_by_hour":
{ Args: { "p_branch"?: string,"p_org": string }; Returns: {
              "bill": number,"hour_of_day": number,"waiter": number
            }[]
                           },
"owner_payments":
{ Args: { "p_before"?: string,"p_before_id"?: string,"p_limit"?: number,"p_org": string }; Returns: {
              "amount_cents": number,"billing_cycle": string,"covers_until": string,"created_at": string,"currency": string,"id": string,"method": string,"paid_on": string,"plan_code": string,"previous_period_end": string,"reference": string,"voided_at": string
            }[]
                           },
"owner_top_dishes":
{ Args: { "p_branch"?: string,"p_days"?: number,"p_limit"?: number,"p_org": string }; Returns: {
              "is_active": boolean,"name": string,"product_id": string,"total_views": number,"views": number
            }[]
                           },
"personnel_begin_reset":
{ Args: { "p_actor": string,"p_membership": string,"p_org": string }; Returns: Json
                           },
"personnel_end_operation":
{ Args: { "p_token": string,"p_user": string }; Returns: undefined
                           },
"personnel_remove_member":
{ Args: { "p_actor": string,"p_membership": string,"p_org": string }; Returns: Json
                           },
"public_menu_status":
{ Args: { "p_branch_slug": string,"p_org_slug": string }; Returns: string
                           },
"purge_expired_orders":
{ Args: { "p_batch"?: number,"p_retention"?: string }; Returns: Json
                           },
"purge_video_comments":
{ Args: { "p_batch"?: number,"p_pending_retention"?: string,"p_rejected_retention"?: string }; Returns: number
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
"record_dish_view":
{ Args: { "p_branch": string,"p_product": string }; Returns: boolean
                           },
"register_push_subscription":
{ Args: { "p_auth": string,"p_endpoint": string,"p_org": string,"p_p256dh": string }; Returns: string
                           },
"reorder_siblings":
{ Args: { "p_current": Json,"p_final": (string)[],"p_org": string,"p_scope": string,"p_table": string }; Returns: undefined
                           },
"replace_organization_logo":
{ Args: { "p_org": string,"p_path": string }; Returns: Json
                           },
"replace_product_image":
{ Args: { "p_org": string,"p_path": string,"p_product": string }; Returns: Json
                           },
"reset_all_table_turns":
{ Args: { "p_org": string }; Returns: number
                           },
"reset_table_turn":
{ Args: { "p_table": string }; Returns: Json
                           },
"resolve_table_qr":
{ Args: { "p_token": string }; Returns: Json
                           },
"save_promotion":
{ Args: { "p_all_branches": boolean,"p_branches": (string)[],"p_categories": (string)[],"p_discount_type": string,"p_discount_value": number,"p_end_minute": number,"p_ends_on": string,"p_id": string,"p_is_active": boolean,"p_name": string,"p_org": string,"p_products": (string)[],"p_start_minute": number,"p_starts_on": string,"p_weekdays_mask": number }; Returns: string
                           },
"set_my_branch_view":
{ Args: { "p_branches": (string)[],"p_org": string }; Returns: string
                           },
"set_my_guide_dismissed":
{ Args: { "p_dismissed": boolean,"p_org": string }; Returns: string
                           },
"set_order_item_status":
{ Args: { "p_item": string,"p_reason"?: string,"p_status": string }; Returns: Json
                           },
"set_video_like":
{ Args: { "p_device": string,"p_liked": boolean,"p_rate"?: string,"p_token": string,"p_video": string,"p_visit_started_at"?: string }; Returns: Json
                           },
"submit_video_comment":
{ Args: { "p_alias"?: string,"p_body": string,"p_rate"?: string,"p_token": string,"p_video": string,"p_visit_started_at"?: string }; Returns: Json
                           },
"unregister_push_subscription":
{ Args: { "p_endpoint": string,"p_org"?: string }; Returns: undefined
                           },
"update_order_item":
{ Args: { "p_item": string,"p_note"?: string,"p_quantity": number }; Returns: Json
                           },
"visit_in_turn":
{ Args: { "p_ticket_at": string,"p_token": string }; Returns: boolean
                           },
"void_order":
{ Args: { "p_order": string,"p_reason"?: string }; Returns: Json
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
