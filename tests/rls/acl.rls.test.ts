import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

/**
 * Comprobaciones de catálogo de la base: ACL y configuración de las funciones SECURITY DEFINER,
 * RLS activado y permisos por columna. La API REST no puede consultar `pg_catalog`, así que se
 * corre SQL dentro del contenedor local de Postgres (`project_id` de supabase/config.toml).
 * Requisitos: Docker encendido, `pnpm db:start` y `pnpm db:reset`.
 */

// Matriz cerrada de funciones: cualquier función nueva hace fallar la prueba hasta que se la declare acá,
// con sus permisos a propósito. Columnas: [definer, anon, public, authenticated].
const PRIVATE_FUNCTIONS: Record<string, [definer: boolean, anon: boolean, authenticated: boolean]> = {
  valid_qr_reset_times: [false, false, true],
  qr_schedule_changed: [false, false, false],
  run_scheduled_table_resets: [true, false, false],
  billing_state: [false, false, false], // pura; solo la usan otras funciones
  can_attend_calls: [true, false, true], // usada por la política de UPDATE de waiter_calls (panel de sala)
  create_trial_subscription: [true, false, false], // trigger
  enforce_branch_limit: [true, false, false], // trigger
  keep_branch_slug_history: [false, false, false], // trigger invocador; no amplía permisos de sucursales
  enforce_product_limit: [true, false, false], // trigger
  assert_account_free: [true, false, false], // reserva de cuentas globales (ficha proteger-cuentas-globales): toma el lock y rechaza si hay reserva; solo la llaman funciones definer
  guard_last_owner: [true, false, false], // trigger de memberships (ADR 0007)
  memberships_account_lease: [true, false, false], // trigger de INSERT en memberships (ficha proteger-cuentas-globales): ninguna membresía entra a una cuenta reservada
  has_feature: [true, false, false],
  is_org_member: [true, false, true], // usada por políticas
  is_org_owner: [true, false, true], // usada por políticas
  can_read_analytics_summary: [true, false, true], // usada por la política de analytics_summaries (ADR 0047): Dueño actual con `analytics` en el plan
  org_can_write: [true, false, true], // usada por políticas de escritura
  org_is_published: [true, true, true], // usada por las políticas de lectura pública (anon incluido)
  org_limit: [true, false, false],
  org_extra_branches: [true, false, false], // sucursales adicionales vigentes (ficha sucursal-adicional): la usan org_limit y org_entitlements, ambas definer; sin EXECUTE para la API
  org_state: [true, false, false],
  plan_grants: [true, false, false],
  enforce_table_limit: [true, false, false], // trigger de tables (ADR 0006 / mesas y QR)
  stamp_attended_call: [false, false, false], // trigger de waiter_calls: fija attended_at y attended_by (panel de sala)
  rotate_table_token: [false, false, false], // trigger de tables: regenera qr_token (ADR 0009)
  limit_table_mute: [false, false, false], // trigger de tables: un silencio dura como máximo 24 horas (configuración del llamado)
  product_image_org: [false, false, true], // pura; la usan las políticas de storage.objects de product-images (ADR 0008)
  organization_logo_org: [false, false, true], // pura; solo las políticas de logos del Dueño
  record_price_change: [true, false, false], // trigger de products: escribe price_history (la API no tiene INSERT)
  record_branch_price_change: [true, false, false], // trigger de product_availability: escribe price_history con la sucursal (ADR 0035)
  price_history_append_only: [false, false, false], // trigger de price_history: rechaza UPDATE, DELETE y TRUNCATE
  purge_organization_price_history: [true, false, false], // purga del historial al borrar una organización (ADR 0026): apaga el trigger de solo-agregado; sin EXECUTE para ningún rol de la API
  purge_expired_payments: [true, false, false], // purga de pagos y anulaciones de organizaciones ya borradas, tras 10 años (ADR 0027): apaga los triggers de solo-agregado; sin EXECUTE para ningún rol de la API
  audit_log_append_only: [false, false, false], // trigger de audit_log: rechaza UPDATE, DELETE y TRUNCATE (SuperAdmin)
  is_push_endpoint: [false, false, false], // pura; la usa la restricción CHECK de push_subscriptions (aviso de llamados, ADR 0020)
  is_platform_admin: [true, false, true], // usada por la política de lectura de audit_log y de payments (SuperAdmin)
  payments_append_only: [false, false, false], // trigger de payments: rechaza UPDATE, DELETE y TRUNCATE (SuperAdmin)
  payment_voids_append_only: [false, false, false], // trigger de payment_voids: rechaza UPDATE, DELETE y TRUNCATE (anular pagos)
  trial_status: [false, false, false], // pura; la usa org_entitlements (estado de la prueba gratuita)
  enforce_option_group_cap: [false, false, false], // trigger de option_groups: tope técnico de 20 grupos por plato (variantes y adicionales)
  enforce_option_cap: [false, false, false], // trigger de options: tope técnico de 60 opciones por grupo (variantes y adicionales)
  can_create_video: [true, false, true], // usada por la política de alta de menu_videos (miembro + cuenta que escribe + feed en el plan)
  enforce_video_cap: [false, false, false], // trigger de menu_videos: tope técnico de 50 videos por organización
  enforce_video_transition: [false, false, false], // trigger de menu_videos: la organización no se mueve y «deleting» es terminal
  enforce_video_publish: [true, false, false], // trigger de menu_videos: feature y cupo del plan al publicar (ADR 0031)
  sync_video_like_count: [true, false, false], // trigger de video_likes: mantiene menu_videos.like_count (ADR 0031)
  sync_video_comment_count: [true, false, false], // trigger de video_comments: mantiene menu_videos.comment_count (ADR 0031)
  enforce_comment_moderation: [false, false, false], // trigger de video_comments: solo cambia el estado, nada vuelve a pendiente (ADR 0031)
  video_is_public: [true, true, true], // usada por la política de lectura PÚBLICA de video_comments: ¿el video se ve hoy en el feed? Solo contesta sí o no
  video_feed_visible: [true, true, true], // usada por la política de lectura PÚBLICA de menu_videos (feed): solo contesta sí o no
  record_order_event: [true, false, false], // trigger de orders y order_items: escribe order_events (la API no tiene INSERT)
  order_events_append_only: [false, false, false], // trigger de order_events: rechaza UPDATE, DELETE y TRUNCATE
  purge_organization_order_events: [true, false, false], // purga del registro de pedidos al borrar una organización (ADR 0041): apaga el trigger de solo-agregado; sin EXECUTE para ningún rol de la API
  end_table_turn: [true, false, false], // turno de mesa (ficha turno-de-mesa, ADR 0044): termina el turno de una mesa y vence su «Pedir la cuenta» pendiente; la llaman close_order, void_order y reset_table_turn; sin EXECUTE para la API
  ticket_in_turn: [true, false, false], // turno de mesa (ficha turno-de-mesa, ADR 0044): ¿el ticket de visita se emitió después del inicio del turno?; sin EXECUTE para la API
  is_org_cook: [true, false, false], // rol de cocinero (ADR 0048): solo la usan las funciones de cocina; sin EXECUTE para la API
  is_org_kitchen: [true, false, false], // Dueño, Staff o cocinero (ADR 0048)
  can_kitchen_orders: [true, false, false], // kitchen_*: trabaja en cocina + función `orders` + cuenta al día
  can_set_item_status: [true, false, false], // set_order_item_status: el cocinero solo ready/noted; Dueño y Staff, todo
  my_assigned_branches: [true, false, false], // personal por sucursal (ficha personal-por-sucursal): sucursales activas asignadas a quien llama; solo la usan funciones de public; sin EXECUTE para la API
  cook_drops_push: [true, false, false], // trigger de memberships: quien pasa a cocinero pierde sus suscripciones push
  can_take_orders: [true, false, false], // la usa add_order_item (ficha pedidos-esquema-y-alta-de-items): miembro + función `orders` en el plan + cuenta al día; sin EXECUTE para la API
  can_manage_reservations: [true, false, false], // reservas (ficha reservas-de-mesa, ADR 0051): Dueño o Staff (no el cocinero) + función `reservations` en el plan + cuenta al día; sin EXECUTE para la API
  reservation_table_is_free: [true, false, false], // reservas: ¿la mesa está libre en ese horario? Solo la llaman las funciones de reservas, con el candado de la mesa tomado; sin EXECUTE para la API
  can_manage_promotions: [true, false, true], // usada por las políticas de escritura de promotions y sus tablas (ficha promociones-y-precio-efectivo): Dueño + función en el plan + cuenta al día
  record_promotion_change: [true, false, false], // trigger de promotions, promotion_targets y promotion_branches: escribe promotion_history (la API no tiene INSERT)
  promotion_history_append_only: [false, false, false], // trigger de promotion_history: rechaza UPDATE, DELETE y TRUNCATE
  purge_organization_promotion_history: [true, false, false], // purga del historial de promociones al borrar una organización (ADR 0040): apaga el trigger de solo-agregado; sin EXECUTE para ningún rol de la API
  translations_valid: [false, false, true], // CHECK de las traducciones (ADR 0023): pura, la evalúa quien escribe (authenticated); no es SECURITY DEFINER
};

// Funciones de la API que NO son SECURITY DEFINER a propósito: corren con los permisos y la RLS de quien llama, así que no amplían nada.
const INVOKER_FUNCTIONS = new Set(["create_product_in_branches", "reorder_siblings", "replace_organization_cover", "replace_organization_logo", "replace_product_image", "save_promotion"]);

// Las únicas funciones de la API (RPC). SECURITY DEFINER a propósito (salvo INVOKER_FUNCTIONS); ver ADR 0006.
const PUBLIC_FUNCTIONS: Record<string, [anon: boolean, authenticated: boolean]> = {
  admin_add_owner: [false, false], // SuperAdmin (ficha dueno-existente): suma una cuenta existente como Dueño; solo service_role
  admin_list_orphan_accounts: [false, false], // SuperAdmin (ficha cuentas-sin-local): lista las cuentas de Auth sin local; solo service_role
  admin_begin_orphan_delete: [false, false], // SuperAdmin (ficha cuentas-sin-local): reserva una cuenta sin local para borrarla; solo service_role
  admin_record_account_deleted: [false, false], // SuperAdmin (ficha cuentas-sin-local): audita el borrado de esa cuenta; solo service_role
  admin_delete_organization: [false, false], // SuperAdmin (ficha borrado-de-organizaciones, ADR 0028): borra definitivamente una organización dada de baja hace 30 días; solo service_role
  admin_end_addon: [false, false], // SuperAdmin (ficha addons-y-baja-de-organizaciones): finaliza un add-on vigente; solo service_role
  admin_set_addon: [false, false], // SuperAdmin (ficha addons-y-baja-de-organizaciones): activa un add-on o cambia packs y fin; solo service_role
  admin_end_feature_preview: [false, false], // SuperAdmin (ficha vistas-previas-de-funciones, ADR 0039): termina una vista previa de función; solo service_role
  admin_set_feature_preview: [false, false], // SuperAdmin (ficha vistas-previas-de-funciones, ADR 0039): habilita una función a una organización con fin y motivo; solo service_role
  admin_set_extra_branches: [false, false], // SuperAdmin (ficha sucursal-adicional, ADR 0039): cantidad de sucursales adicionales y sucursales a desactivar; solo service_role
  admin_set_organization_active: [false, false], // SuperAdmin (ficha addons-y-baja-de-organizaciones, ADR 0025): da de baja o reactiva una organización; solo service_role
  admin_change_plan: [false, false], // SuperAdmin (ficha superadmin-planes-pagos): solo service_role, desde la acción de servidor
  admin_create_organization: [false, false], // SuperAdmin (ADR 0013): solo service_role, desde la acción de servidor
  admin_register_payment: [false, false], // SuperAdmin: registra un pago y mueve la vigencia; solo service_role
  admin_set_suspension: [false, false], // SuperAdmin: suspende o reactiva a mano; solo service_role
  admin_void_payment: [false, false], // SuperAdmin (ficha anular-pagos): anula el último pago vigente y restaura la vigencia; solo service_role
  drop_push_subscriptions: [false, false], // aviso de llamados (ADR 0020): limpia suscripciones muertas; solo service_role
  submit_video_comment: [false, false], // única puerta de alta de video_comments; solo service_role, la llama la acción de servidor tras verificar ticket y conexión (ADR 0031, 0038)
  purge_video_comments: [false, false], // retención de comentarios rechazados y pendientes viejos (ADR 0031): solo service_role
  set_video_like: [false, false], // única puerta de escritura de video_likes; solo service_role (ADR 0031, 0038)
  create_waiter_call: [false, false], // única puerta de escritura de waiter_calls; solo service_role (ADR 0010, 0038)
  kitchen_orders: [false, true], // pantalla de cocina (ADR 0048): pedidos abiertos sin precios; valida adentro (rol de cocina, plan, mora)
  kitchen_branches: [false, true], // pantalla de cocina: sucursales activas (id y nombre)
  kitchen_menu: [false, true], // pantalla de cocina: platos activos y visibles de una sucursal, sin precios
  set_kitchen_availability: [false, true], // pantalla de cocina: agotado/disponible (solo is_available); valida adentro
  set_order_item_status: [false, true], // pedidos del mozo (ficha pedidos-estados-y-registro): estados de una línea; valida adentro (miembro, plan, mora)
  update_order_item: [false, true], // pedidos del mozo: cantidad y observación de una línea anotada; valida adentro
  close_order: [false, true], // pedidos del mozo: cierra un pedido; solo exige ser miembro (nunca se bloquea por mora)
  void_order: [false, true], // pedidos del mozo: anula un pedido con motivo; solo exige ser miembro (nunca se bloquea por mora)
  visit_in_turn: [false, false], // visita vigente en el turno de la mesa (ficha turno-de-mesa, ADR 0044): solo service_role, desde la página pública /t/{token} tras verificar el ticket; devuelve un booleano
  get_table_account: [false, false], // cuenta del comensal (ficha cuenta-del-comensal, ADR 0044): única lectura de pedidos para un anónimo; solo service_role, desde la acción de servidor tras verificar el ticket
  reset_table_turn: [false, true], // turno de mesa (ficha turno-de-mesa, ADR 0044): el miembro reinicia a mano el turno de una mesa; nunca se bloquea por plan ni mora
  reset_all_table_turns: [false, true],
  owner_qr_reset_schedules: [false, true],
  create_reservation: [false, true], // reservas (ficha reservas-de-mesa, ADR 0051): única puerta de alta de reservations; valida adentro (miembro que no sea cocinero, plan, mora)
  assign_reservation_table: [false, true], // reservas: asigna una mesa libre y confirma; valida adentro
  set_reservation_status: [false, true], // reservas: cancelar, rechazar, sentar, «no vino» o soltar la mesa según las transiciones permitidas; valida adentro
  purge_expired_reservations: [false, false], // purga de reservas terminadas hace más de 30 días (ADR 0051): SECURITY DEFINER, solo service_role
  add_order_item: [false, true], // pedidos del mozo (ficha pedidos-esquema-y-alta-de-items, ADR 0041): única puerta de escritura de orders y order_items; valida adentro (miembro, plan, mora)
  org_entitlements: [false, true],
  owner_calls_by_hour: [false, true], // analítica básica (ADR 0022): llamados por hora para el Dueño con el plan; vuelve a comprobar todo; solo lectura
  owner_top_dishes: [false, true], // analítica básica (ADR 0022): platos más vistos para el Dueño con el plan; vuelve a comprobar todo; solo lectura
  owner_sales_overview: [false, true], // analítica de pedidos (ADR 0045): ventas, franjas y control para el Dueño con el plan; vuelve a comprobar todo; solo lectura
  owner_products_performance: [false, true], // analítica de pedidos (ADR 0045): platos más vendidos y sin pedidos para el Dueño con el plan; vuelve a comprobar todo; solo lectura
  save_analytics_summary: [false, false], // resumen con IA de la analítica (ADR 0047): única puerta de escritura de analytics_summaries; solo service_role, desde la acción del servidor con el texto ya validado
  claim_analytics_summary: [false, false], // resumen con IA (ADR 0047): reserva atómica del período antes de llamar al servicio externo; solo service_role (el Dueño no puede esquivar el tiempo mínimo); valida p_user adentro
  release_analytics_summary_claim: [false, false], // resumen con IA (ADR 0047): devuelve la reserva si el pedido falló; solo service_role; valida p_user adentro
  owner_account_history: [false, true], // el Dueño lee el historial de cambios de su cuenta (ADR 0021): vuelve a comprobar que sea Dueño; solo lectura
  owner_payments: [false, true], // el Dueño lee los pagos de su cuenta (ADR 0021): vuelve a comprobar que sea Dueño; solo lectura
  public_menu_status: [true, true],
  push_subscription_registered: [false, true], // aviso de llamados (ADR 0020): ¿está registrado este dispositivo? Solo lo propio
  push_targets_for_call: [false, false], // aviso de llamados (ADR 0020): a quién avisar de un llamado nuevo; solo service_role

  record_dish_view: [true, true], // analítica básica (ADR 0022): la carta pública suma una vista; solo contadores y valida adentro
  personnel_begin_reset: [false, false], // personal (ficha proteger-cuentas-globales): comprueba y reserva la cuenta antes de cambiarle la contraseña; solo service_role
  personnel_end_operation: [false, false], // personal: libera la reserva de la cuenta; solo service_role
  personnel_remove_member: [false, false], // personal: quita la membresía y reserva el borrado de la cuenta si corresponde; solo service_role
  my_guide_dismissed: [false, true], // guía de primeros pasos (ficha guia-descartable): si quien llama la ocultó; solo lo propio
  set_my_guide_dismissed: [false, true], // guía de primeros pasos: oculta o muestra la guía de quien llama; valida adentro (miembro)
  my_branch_access: [false, true], // personal por sucursal (ficha personal-por-sucursal): la vista efectiva y las sucursales asignadas de quien llama; solo lo propio
  my_branch_view: [false, true], // vista por sucursal (ficha vista-por-sucursal, ADR 0034): la vista efectiva de quien llama; solo lo propio
  purge_waiter_calls: [false, false], // purga por antigüedad (ADR 0014): solo service_role
  purge_expired_orders: [false, false], // purga de pedidos de más de 2 años (ADR 0043): SECURITY DEFINER, solo service_role
  create_product_in_branches: [false, true], // alta del plato con sucursales donde se oculta (ADR 0035): SECURITY INVOKER, manda la RLS de quien llama
  reorder_siblings: [false, true], // orden de la carta (ficha orden-e-imagenes-atomicos): SECURITY INVOKER, manda la RLS de quien llama
  replace_organization_cover: [false, true], // portada del local: SECURITY INVOKER, devuelve la portada saliente; manda la RLS del Dueño
  replace_organization_logo: [false, true], // logo del local: SECURITY INVOKER, devuelve el logo saliente; manda la RLS del Dueño
  replace_product_image: [false, true], // foto del plato: SECURITY INVOKER, devuelve la foto saliente; manda la RLS de quien llama
  register_push_subscription: [false, true], // aviso de llamados (ADR 0020): el miembro registra su dispositivo; valida adentro
  set_my_branch_view: [false, true], // vista por sucursal: guarda la elección de quien llama; valida adentro (miembro, sucursales activas del local)
  save_promotion: [false, true], // guarda una promoción con sus platos y sucursales en una transacción (ficha panel-de-promociones): SECURITY INVOKER, manda la RLS del Dueño
  effective_prices: [true, true], // precio efectivo de la carta y los pedidos (ADR 0040): SECURITY DEFINER, solo devuelve lo que la carta publica; el instante solo lo elige un miembro
  resolve_table_qr: [true, true], // entrada pública /t/{token} (ADR 0009): anon no lee public.tables
  unregister_push_subscription: [false, true], // aviso de llamados (ADR 0020): borra solo las suscripciones propias
};

describe("funciones de autorización y entitlements", () => {
  it("el esquema private tiene exactamente las funciones esperadas", () => {
    const todas = sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' order by 1`,
    );
    expect(todas.flat()).toEqual(Object.keys(PRIVATE_FUNCTIONS).sort());
  });

  it("todas fijan search_path vacío y son de postgres; SECURITY DEFINER donde corresponde", () => {
    const filas = sql(`
      select p.proname, p.prosecdef,
             coalesce(p.proconfig @> array['search_path=""'], false),
             pg_get_userbyid(p.proowner) = 'postgres'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'public') order by 1`);

    for (const [nombre, definer, searchPath, postgres] of filas) {
      const esperado = PRIVATE_FUNCTIONS[nombre] ?? undefined;
      expect(searchPath, `${nombre}: search_path vacío`).toBe("t");
      expect(postgres, `${nombre}: propietaria postgres`).toBe("t");
      if (esperado) expect(definer, `${nombre}: SECURITY DEFINER`).toBe(esperado[0] ? "t" : "f");
      else if (INVOKER_FUNCTIONS.has(nombre)) expect(definer, `${nombre}: SECURITY INVOKER (manda la RLS de quien llama)`).toBe("f");
      else expect(definer, `${nombre}: SECURITY DEFINER en la API`).toBe("t");
    }
  });

  it("EXECUTE de las funciones de private coincide con la matriz (public nunca)", () => {
    const filas = sql(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' order by 1`);

    for (const [nombre, anon, publico, authenticated] of filas) {
      const [, anonOk, authOk] = PRIVATE_FUNCTIONS[nombre];
      expect(anon, `${nombre}: anon`).toBe(anonOk ? "t" : "f");
      expect(publico, `${nombre}: public`).toBe("f");
      expect(authenticated, `${nombre}: authenticated`).toBe(authOk ? "t" : "f");
    }
  });

  it("las funciones de public son exactamente las dos de la API, con sus permisos", () => {
    const filas = sql(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`);

    expect(filas.map((f) => f[0])).toEqual(Object.keys(PUBLIC_FUNCTIONS).sort());
    for (const [nombre, anon, publico, authenticated] of filas) {
      const [anonOk, authOk] = PUBLIC_FUNCTIONS[nombre];
      expect(anon, `${nombre}: anon`).toBe(anonOk ? "t" : "f");
      expect(publico, `${nombre}: public`).toBe("f");
      expect(authenticated, `${nombre}: authenticated`).toBe(authOk ? "t" : "f");
    }
  });

  it("anon puede usar el esquema private solo para evaluar las políticas públicas", () => {
    const esquema = sql(
      `select has_schema_privilege('anon', 'private', 'usage'), has_schema_privilege('authenticated', 'private', 'usage'), has_schema_privilege('public', 'private', 'usage')`,
    );
    expect(esquema).toEqual([["t", "t", "f"]]);
  });
});

describe("RLS y permisos de tablas", () => {
  it("toda tabla del esquema public tiene RLS activado", () => {
    const sinRls = sql(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(sinRls).toEqual([]);
  });

  it("memberships: anon sin ningún permiso y authenticated solo con SELECT", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.memberships', '${p}')`)
          .join(", ")}`,
      )[0];

    expect(permisos("anon")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("authenticated")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
  });

  it("tables: anon sin permisos; authenticated puede borrar (borrado de mesas) pero no truncar; waiter_calls sigue sin permisos de escritura", () => {
    const permisos = (rol: string, tabla: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.${tabla}', '${p}')`)
          .join(", ")}`,
      )[0];

    expect(permisos("anon", "tables")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    // INSERT y UPDATE son por columna (no figuran a nivel de tabla); DELETE es nuevo.
    expect(permisos("authenticated", "tables")).toEqual(["t", "f", "f", "t", "f", "f", "f"]);
    // Los llamados se borran por la cascada de la mesa (corre con el dueño de la tabla), no por un permiso de la API.
    expect(permisos("anon", "waiter_calls")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("authenticated", "waiter_calls").slice(1)).toEqual(["f", "f", "f", "f", "f", "f"]);
  });

  it("planes y suscripciones: anon sin permisos y authenticated solo con SELECT", () => {
    const permisos = (rol: string, tabla: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate"]
          .map((p) => `has_table_privilege('${rol}', 'public.${tabla}', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const tabla of ["plans", "addons", "subscriptions", "subscription_addons"]) {
      expect(permisos("anon", tabla), `${tabla}: anon`).toEqual(["f", "f", "f", "f", "f"]);
      expect(permisos("authenticated", tabla), `${tabla}: authenticated`).toEqual(["t", "f", "f", "f", "f"]);
    }
  });

  it("price_history: anon sin permisos; authenticated y service_role solo con SELECT (se escribe por trigger)", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.price_history', '${p}')`)
          .join(", ")}`,
      )[0];

    expect(permisos("anon")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("authenticated")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("service_role")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
  });

  it("las acciones de SuperAdmin (alta, Dueño existente, plan, suspensión, pago, anular pago): solo service_role puede ejecutarlas", () => {
    const filas = sql(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'admin\_%' order by 1`);
    expect(filas).toEqual([
      ["admin_add_owner", "f", "f", "f", "t"],
      ["admin_begin_orphan_delete", "f", "f", "f", "t"],
      ["admin_change_plan", "f", "f", "f", "t"],
      ["admin_create_organization", "f", "f", "f", "t"],
      ["admin_delete_organization", "f", "f", "f", "t"],
      ["admin_end_addon", "f", "f", "f", "t"],
      ["admin_end_feature_preview", "f", "f", "f", "t"],
      ["admin_list_orphan_accounts", "f", "f", "f", "t"],
      ["admin_record_account_deleted", "f", "f", "f", "t"],
      ["admin_register_payment", "f", "f", "f", "t"],
      ["admin_set_addon", "f", "f", "f", "t"],
      ["admin_set_extra_branches", "f", "f", "f", "t"],
      ["admin_set_feature_preview", "f", "f", "f", "t"],
      ["admin_set_organization_active", "f", "f", "f", "t"],
      ["admin_set_suspension", "f", "f", "f", "t"],
      ["admin_void_payment", "f", "f", "f", "t"],
    ]);
  });

  it("organization_feature_previews: anon y authenticated sin ningún permiso; service_role solo lee (la escriben las funciones auditadas)", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.organization_feature_previews', '${p}')`)
          .join(", ")}`,
      )[0];

    expect(permisos("anon")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("authenticated")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("service_role")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
  });

  it("platform_admins, audit_log, payments y payment_voids: anon sin permisos; authenticated solo lee; service_role solo lee (nada escribe por la API)", () => {
    const permisos = (rol: string, tabla: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.${tabla}', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const tabla of ["platform_admins", "audit_log", "payments", "payment_voids"]) {
      expect(permisos("anon", tabla), `${tabla}: anon`).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
      expect(permisos("authenticated", tabla), `${tabla}: authenticated`).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
      expect(permisos("service_role", tabla), `${tabla}: service_role`).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("private.account_leases: nadie la toca por la API (ni anon, ni authenticated, ni service_role); solo las funciones definer", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'private.account_leases', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const rol of ["anon", "authenticated", "service_role"]) {
      expect(permisos(rol), `account_leases: ${rol}`).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("member_branch_views (vista por sucursal): nadie la toca por la API (ni anon, ni authenticated, ni service_role); solo funciones", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.member_branch_views', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const rol of ["anon", "authenticated", "service_role"]) {
      expect(permisos(rol), `member_branch_views: ${rol}`).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("push_subscriptions: nadie la toca directamente (ni anon, ni authenticated, ni service_role); solo funciones", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.push_subscriptions', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const rol of ["anon", "authenticated", "service_role"]) {
      expect(permisos(rol), `push_subscriptions: ${rol}`).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("las funciones del aviso de llamados: quién ejecuta cada una (service_role las tiene todas por defecto, pero sin sesión no es nadie: auth.uid() es nulo)", () => {
    const filas = sql(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%push%' order by 1`);
    expect(filas).toEqual([
      ["drop_push_subscriptions", "f", "f", "f", "t"],
      ["push_subscription_registered", "f", "t", "f", "t"],
      ["push_targets_for_call", "f", "f", "f", "t"],
      ["register_push_subscription", "f", "t", "f", "t"],
      ["unregister_push_subscription", "f", "t", "f", "t"],
    ]);
  });

  it("organization_id, id, slug y is_active no son actualizables por la API", () => {
    const actualizables = sql(`
      select t.tabla, t.columna from (values
        ('organizations', 'id'), ('organizations', 'slug'), ('organizations', 'is_active'),
        ('branches', 'id'), ('branches', 'organization_id'), ('branches', 'slug'),
        ('categories', 'id'), ('categories', 'organization_id'),
        ('products', 'id'), ('products', 'organization_id'), ('products', 'currency'),
        ('option_groups', 'id'), ('option_groups', 'organization_id'), ('option_groups', 'product_id'), ('option_groups', 'created_at'),
        ('options', 'id'), ('options', 'organization_id'), ('options', 'group_id'), ('options', 'created_at')
      ) as t(tabla, columna)
      where has_column_privilege('authenticated', 'public.' || t.tabla, t.columna, 'update')
         or has_column_privilege('anon', 'public.' || t.tabla, t.columna, 'update')`);
    expect(actualizables).toEqual([]);
  });

  it("las únicas columnas de mesas, sucursales y llamados que la API actualiza son las previstas (configuración del llamado)", () => {
    const columnas = (rol: string) =>
      sql(`
        select table_name, column_name from information_schema.column_privileges
        where grantee = '${rol}' and privilege_type = 'UPDATE' and table_schema = 'public'
          and table_name in ('tables', 'branches', 'waiter_calls')
        order by table_name, column_name`);

    expect(columnas("authenticated")).toEqual([
      ["branches", "google_review_url"], // solo el Dueño con la cuenta al día, por la política de branches (ficha enlace-de-resenas-de-google)
      ["branches", "is_active"], // solo el Dueño y con la cuenta al día, por la política de branches (ficha desactivar-sucursales)
      ["branches", "name"],
      ["branches", "qr_reset_times"],
      ["branches", "timezone"], // solo el Dueño con la cuenta al día, por la política de branches (ficha zona-horaria-por-sucursal)
      ["branches", "tip_percent"], // solo el Dueño con la cuenta al día, por la política de branches (ficha propina-sugerida)
      ["branches", "waiter_call_cooldown_seconds"], // solo el Dueño, por la política de branches
      ["tables", "is_active"],
      ["tables", "label"],
      ["tables", "muted_until"], // Dueño y Staff; un trigger limita el silencio a 24 horas
      ["tables", "qr_token"],
      ["waiter_calls", "status"], // solo pending → attended, por política
    ]);
    expect(columnas("anon")).toEqual([]);
  });

  it("anon no tiene ningún permiso de escritura en las tablas de negocio", () => {
    const conEscritura = sql(`
      select t.tabla, p.permiso from (values ('organizations'), ('branches'), ('categories'), ('products'), ('memberships'), ('option_groups'), ('options')) as t(tabla)
      cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(permiso)
      where has_table_privilege('anon', 'public.' || t.tabla, p.permiso)`);
    expect(conEscritura).toEqual([]);
  });

  it("authenticated no tiene INSERT ni DELETE de tabla completa en organizaciones, sucursales ni membresías (el alta de sucursales es por columna, abajo)", () => {
    const conPermiso = sql(`
      select t.tabla, p.permiso from (values ('organizations'), ('branches'), ('memberships')) as t(tabla)
      cross join (values ('insert'), ('delete'), ('truncate')) as p(permiso)
      where has_table_privilege('authenticated', 'public.' || t.tabla, p.permiso)`);
    expect(conPermiso).toEqual([]);
  });

  it("las únicas columnas de sucursales que la API inserta son organization_id, slug y name (gestión de sucursales)", () => {
    const columnas = (rol: string) =>
      sql(`
        select column_name from information_schema.column_privileges
        where grantee = '${rol}' and privilege_type = 'INSERT' and table_schema = 'public' and table_name = 'branches'
        order by column_name`);

    expect(columnas("authenticated")).toEqual([["name"], ["organization_id"], ["slug"]]);
    expect(columnas("anon")).toEqual([]);
  });
});
