import type { Lang } from "./idiomas";

/**
 * Textos fijos de la carta pública en cada idioma (ficha carta-en-varios-idiomas, ADR 0023): botones, avisos y etiquetas.
 * Lo que carga el local (platos, categorías, opciones) se traduce aparte, con `translations`. Nada se traduce con un
 * servicio externo: estos textos los escribimos nosotros una vez. Módulo puro, sin dependencias: lo usan componentes de
 * servidor y de cliente. El español es el original y no cambia el texto que ya mostraba la carta.
 *
 * Los textos legales (`/terminos`, `/privacidad`, `/alergenos`) siguen en español: traducirlos pide revisión legal.
 */

export type Textos = {
  /** Título de la pestaña. */
  cartaDe: (organization: string) => string;
  notFoundTitle: string;
  unavailableTitle: (organization: string) => string;
  branch: (name: string) => string;
  logoAlt: (organization: string) => string;
  emptyTitle: string;
  emptyHint: string;
  footerAllergens: string;
  /** La versión corta del aviso, dentro del detalle de un plato. */
  detailAllergens: string;
  madeWith: string;
  languageLabel: string;
  /** Invitación a reseñar en Google (ficha invitacion-a-resenar): textos fijos, iguales para todos y que el local no edita. */
  review: { footer: string; invite: string; action: string; close: string };
  legal: { nav: string; terms: string; privacy: string; allergens: string };
  count: {
    dishes: (n: number) => string;
    /** «3 platos encontrados» / «3 platos en la carta». */
    status: (n: number, filtering: boolean) => string;
  };
  search: {
    region: string;
    label: string;
    placeholder: string;
    tagsLegend: string;
    tagsNotice: string;
    allTags: string;
    allergenLink: string;
    clear: string;
    emptyTitle: string;
    emptyHint: string;
    /** Cuando hay etiquetas elegidas y no aparece ningún plato: la falta de resultados no es una afirmación sobre el local. */
    emptyHintTags: string;
  };
  dietary: { gluten_free: string; vegan: string; vegetarian: string; list: string };
  categories: { index: string; bar: string };
  dish: {
    soldOut: string;
    soldOutBranch: string;
    /** Dentro del detalle, bajo las etiquetas dietarias: son una declaración del local, no una garantía. */
    tagsNote: string;
    /** Además, cuando el plato tiene variantes o adicionales: pueden cambiar lo declarado. */
    tagsOptionsNote: string;
    photoAlt: (name: string) => string;
    viewDetail: (name: string) => string;
    back: string;
  };
  /** Precio promocional (ficha carta-con-precio-promocional): el precio anterior tachado y hasta cuándo rige. */
  promo: { was: string; until: (time: string, day: "today" | "tomorrow" | "later", date: string) => string };
  options: { rule: (min: number, max: number) => string; more: (n: number) => string };
  call: {
    form: string;
    waiter: string;
    bill: string;
    sending: string;
    expired: string;
    unavailable: string;
    created: { waiter: string; bill: string };
    already: { waiter: string; bill: string };
    cooldown: (seconds: number) => string;
    rateLimited: (minutes: number) => string;
  };
  /** Cuenta del comensal (ficha cuenta-del-comensal): lo que ve quien pidió la cuenta. No es una factura. */
  account: {
    consumed: string;
    tipSuggested: string;
    tipTotal: string;
    tipOptional: string;
    view: string;
    title: string;
    loading: string;
    error: string;
    empty: string;
    total: string;
    dishes: (n: number) => string;
    each: (price: string) => string;
    legend: string;
    note: string;
    asOf: (time: string) => string;
    refresh: string;
    close: string;
  };
  /** Feed de videos (ficha feed-de-videos). */
  feed: {
    /** El acceso desde la carta. */
    link: string;
    /** El mismo acceso, corto, para la celda del dock de la mesa (el nombre accesible sigue siendo `link`). */
    dockLink: string;
    pageTitle: (organization: string) => string;
    heading: string;
    back: string;
    position: (n: number, total: number) => string;
    mute: string;
    unmute: string;
    play: string;
    pause: string;
    viewDish: string;
    hideDish: string;
    videoError: string;
    emptyTitle: string;
    emptyHint: string;
    nextVideo: string;
    previousVideo: string;
    /** Likes (ficha likes-del-feed). */
    like: string;
    unlike: string;
    likeCount: (n: number) => string;
    likeError: string;
    /** Comentarios con aprobación previa (ficha comentarios-del-feed). */
    comments: string;
    commentsCount: (n: number) => string;
    closeComments: string;
    commentsEmpty: string;
    commentsMore: string;
    commentsRetry: string;
    commentsLoading: string;
    commentsLoadError: string;
    anonymous: string;
    commentAliasLabel: string;
    commentBodyLabel: string;
    commentPlaceholder: string;
    commentCounter: (used: number, max: number) => string;
    commentWrite: string;
    commentCancel: string;
    commentSend: string;
    commentSending: string;
    commentSent: string;
    commentInvalid: string;
    commentQueueFull: string;
    commentRateLimited: (minutes: number) => string;
    commentError: string;
  };
  unavailable: { suspendedTitle: string; suspendedBody: string; inactiveTitle: string; inactiveBody: string };
};

const es: Textos = {
  cartaDe: (organization) => `Carta de ${organization}`,
  notFoundTitle: "Carta no encontrada",
  unavailableTitle: (organization) => `${organization} · Carta no disponible`,
  branch: (name) => `Sucursal ${name}`,
  logoAlt: (organization) => `Logo de ${organization}`,
  emptyTitle: "Esta carta todavía no tiene platos.",
  emptyHint: "Volvé a mirar en unos minutos.",
  footerAllergens: "Esta carta no informa los alérgenos de cada plato: un plato sin etiqueta no está declarado como apto para ninguna dieta. Si tenés alergia, intolerancia o celiaquía, consultá al personal antes de pedir.",
  detailAllergens: "Si tenés alergia, intolerancia o celiaquía, consultá al personal antes de pedir. Que un plato no tenga etiqueta no significa que sea apto para vos.",
  madeWith: "Hecho con UcoMenu",
  languageLabel: "Idioma",
  review: { footer: "Dejá tu reseña en Google", invite: "Si querés, podés dejar tu reseña de este lugar en Google.", action: "Dejar una reseña", close: "Cerrar" },
  legal: { nav: "Información legal", terms: "Términos de uso", privacy: "Privacidad", allergens: "Aviso de alérgenos" },
  count: {
    dishes: (n) => (n === 1 ? "1 plato" : `${n} platos`),
    status: (n, filtering) =>
      `${n === 1 ? "1 plato" : `${n} platos`}${filtering ? (n === 1 ? " encontrado" : " encontrados") : " en la carta"}`,
  },
  search: {
    region: "Buscar y filtrar la carta",
    label: "Buscar platos",
    placeholder: "Nombre o descripción",
    tagsLegend: "Etiquetas declaradas por el local",
    tagsNotice: "Etiquetas declaradas por el local, no certificadas: con alergias o celiaquía, consultá al personal antes de pedir.",
    allTags: "Se muestran los platos que tienen todas las etiquetas elegidas.",
    allergenLink: "Aviso de alérgenos",
    clear: "Limpiar búsqueda y filtros",
    emptyTitle: "No encontramos platos con esa búsqueda.",
    emptyHint: "Probá con otro nombre o quitá algún filtro.",
    emptyHintTags: "Que no aparezcan platos no significa que el local no tenga opciones para tu dieta: consultá al personal.",
  },
  dietary: { gluten_free: "Sin TACC", vegan: "Vegano", vegetarian: "Vegetariano", list: "Etiquetas dietarias declaradas por el local" },
  categories: { index: "Categorías de la carta", bar: "Cambiar de categoría" },
  dish: {
    soldOut: "Agotado",
    soldOutBranch: "Agotado en esta sucursal",
    tagsNote: "Etiqueta declarada por el local, no certificada. Puede haber contacto con otros ingredientes durante la preparación.",
    tagsOptionsNote: "Las opciones y adicionales pueden cambiar estas etiquetas: consultá al personal antes de elegirlas.",
    photoAlt: (name) => `Foto de ${name}`,
    viewDetail: (name) => `Ver detalle de ${name}`,
    back: "Volver a la carta",
  },
  promo: {
    was: "Precio anterior",
    until: (time, day, date) => {
      if (day === "today") return `Hasta las ${time}`;
      if (day === "tomorrow") return time === "00:00" ? "Hasta la medianoche" : `Hasta las ${time} de mañana`;
      return `Hasta el ${date} a las ${time}`;
    },
  },
  options: {
    rule: (min, max) => {
      if (min === 0) return `Opcional · hasta ${max}`;
      if (min === max) return `Elegí ${min}`;
      return `Elegí de ${min} a ${max}`;
    },
    more: (n) => (n === 1 ? "1 opción más en el detalle" : `${n} opciones más en el detalle`),
  },
  call: {
    form: "Avisar al personal",
    waiter: "Llamar al mozo",
    bill: "Pedir la cuenta",
    sending: "Enviando…",
    expired: "Esta sesión venció. Escaneá de nuevo el QR de tu mesa para avisar al personal.",
    unavailable: "Por ahora no se puede avisar desde acá. Levantá la mano o buscá al personal.",
    created: { waiter: "Avisamos al personal. En un momento te atienden.", bill: "Pedimos tu cuenta. En un momento te la acercan." },
    already: { waiter: "Ya avisamos al personal. Enseguida te atienden.", bill: "Ya pedimos tu cuenta. Enseguida te la acercan." },
    cooldown: (s) => `Ya avisaste hace un momento. Podés volver a avisar en ${s} ${s === 1 ? "segundo" : "segundos"}.`,
    rateLimited: (m) => `Se hicieron demasiados avisos desde tu conexión. Probá de nuevo en ${m} ${m === 1 ? "minuto" : "minutos"}.`,
  },
  account: {
    view: "Ver mi cuenta",
    title: "Tu cuenta",
    loading: "Buscando tu cuenta…",
    error: "No pudimos mostrar tu cuenta. Pedísela al mozo.",
    empty: "Todavía no hay platos anotados en tu mesa.",
    total: "Total hasta ahora",
    consumed: "Total consumido",
    tipSuggested: "Propina sugerida",
    tipTotal: "Total con propina sugerida",
    tipOptional: "La propina es opcional",
    dishes: (n) => (n === 1 ? "1 plato" : `${n} platos`),
    each: (price) => `${price} c/u`,
    legend: "No válida como factura",
    note: "Es lo anotado hasta ahora: el mozo puede sumar más. El importe final lo confirma el personal.",
    asOf: (time) => `Actualizada a las ${time}`,
    refresh: "Actualizar",
    close: "Cerrar",
  },
  feed: {
    link: "Ver Menufeed",
    dockLink: "Menufeed",
    pageTitle: (organization) => `Menufeed de ${organization}`,
    heading: "Menufeed",
    back: "Volver a la carta",
    position: (n, total) => `Video ${n} de ${total}`,
    mute: "Silenciar",
    unmute: "Activar el sonido",
    play: "Reproducir",
    pause: "Pausar",
    viewDish: "Ver plato",
    hideDish: "Cerrar",
    videoError: "No se pudo reproducir este video.",
    emptyTitle: "Todavía no hay videos",
    emptyHint: "Cuando el local publique videos, los vas a ver acá. Mientras tanto, mirá la carta.",
    nextVideo: "Video siguiente",
    previousVideo: "Video anterior",
    like: "Me gusta",
    unlike: "Quitar me gusta",
    likeCount: (n) => `${n} me gusta`,
    likeError: "No se pudo registrar tu me gusta. Probá de nuevo en un momento.",
    comments: "Comentarios",
    commentsCount: (n) => `${n} ${n === 1 ? "comentario" : "comentarios"}`,
    closeComments: "Cerrar los comentarios",
    commentsEmpty: "Todavía no hay comentarios.",
    commentsMore: "Ver más comentarios",
    commentsRetry: "Reintentar",
    commentsLoading: "Cargando…",
    commentsLoadError: "No se pudieron cargar los comentarios. Probá de nuevo en un momento.",
    anonymous: "Anónimo",
    commentAliasLabel: "Tu nombre (opcional)",
    commentBodyLabel: "Tu comentario",
    commentPlaceholder: "Contanos qué te pareció",
    commentCounter: (used, max) => `${used} de ${max}`,
    commentWrite: "Escribir un comentario",
    commentCancel: "Cancelar",
    commentSend: "Enviar comentario",
    commentSending: "Enviando…",
    commentSent: "Gracias. Tu comentario se publicará cuando el local lo apruebe.",
    commentInvalid: "Escribí un comentario de hasta 280 caracteres y un nombre de hasta 30.",
    commentQueueFull: "El local tiene muchos comentarios por revisar. Probá de nuevo más tarde.",
    commentRateLimited: (m) => `Se enviaron demasiados comentarios en poco tiempo. Probá de nuevo en ${m} ${m === 1 ? "minuto" : "minutos"}.`,
    commentError: "No se pudo enviar tu comentario. Probá de nuevo en un momento.",
  },
  unavailable: {
    suspendedTitle: "Carta temporalmente no disponible",
    suspendedBody: "El local está actualizando su servicio. Consultá al personal si querés ver la carta ahora.",
    inactiveTitle: "Esta sucursal no está disponible",
    inactiveBody: "Esta sucursal no está atendiendo por ahora. Consultá al personal si querés ver la carta ahora.",
  },
};

const en: Textos = {
  cartaDe: (organization) => `${organization} menu`,
  notFoundTitle: "Menu not found",
  unavailableTitle: (organization) => `${organization} · Menu unavailable`,
  branch: (name) => `Location ${name}`,
  logoAlt: (organization) => `${organization} logo`,
  emptyTitle: "This menu has no dishes yet.",
  emptyHint: "Check back in a few minutes.",
  footerAllergens: "This menu does not list the allergens of each dish: a dish without a tag is not declared suitable for any diet. If you have an allergy, intolerance or celiac disease, ask the staff before ordering.",
  detailAllergens: "If you have an allergy, intolerance or celiac disease, ask the staff before ordering. A dish without a tag is not necessarily suitable for you.",
  madeWith: "Made with UcoMenu",
  languageLabel: "Language",
  review: { footer: "Leave a review on Google", invite: "If you'd like, you can leave a review of this place on Google.", action: "Leave a review", close: "Close" },
  legal: { nav: "Legal information", terms: "Terms of use", privacy: "Privacy", allergens: "Allergen notice" },
  count: {
    dishes: (n) => (n === 1 ? "1 dish" : `${n} dishes`),
    status: (n, filtering) => `${n === 1 ? "1 dish" : `${n} dishes`}${filtering ? " found" : " on the menu"}`,
  },
  search: {
    region: "Search and filter the menu",
    label: "Search dishes",
    placeholder: "Name or description",
    tagsLegend: "Tags declared by the restaurant",
    tagsNotice: "Tags are declared by the restaurant, not certified: if you have allergies or celiac disease, ask the staff before ordering.",
    allTags: "Showing dishes that have all the selected tags.",
    allergenLink: "Allergen notice",
    clear: "Clear search and filters",
    emptyTitle: "We couldn't find dishes matching that search.",
    emptyHint: "Try another name or remove a filter.",
    emptyHintTags: "No dishes showing does not mean the restaurant has no options for your diet: ask the staff.",
  },
  dietary: { gluten_free: "Gluten-free", vegan: "Vegan", vegetarian: "Vegetarian", list: "Dietary tags declared by the restaurant" },
  categories: { index: "Menu categories", bar: "Switch category" },
  dish: {
    soldOut: "Sold out",
    soldOutBranch: "Sold out at this location",
    tagsNote: "Tag declared by the restaurant, not certified. There may be contact with other ingredients during preparation.",
    tagsOptionsNote: "Options and extras can change these tags: ask the staff before choosing them.",
    photoAlt: (name) => `Photo of ${name}`,
    viewDetail: (name) => `View details of ${name}`,
    back: "Back to the menu",
  },
  promo: {
    was: "Previous price",
    until: (time, day, date) => {
      if (day === "today") return `Until ${time}`;
      if (day === "tomorrow") return time === "00:00" ? "Until midnight" : `Until ${time} tomorrow`;
      return `Until ${date} at ${time}`;
    },
  },
  options: {
    rule: (min, max) => {
      if (min === 0) return `Optional · up to ${max}`;
      if (min === max) return `Choose ${min}`;
      return `Choose ${min} to ${max}`;
    },
    more: (n) => (n === 1 ? "1 more option in the details" : `${n} more options in the details`),
  },
  call: {
    form: "Notify the staff",
    waiter: "Call the waiter",
    bill: "Ask for the check",
    sending: "Sending…",
    expired: "This session has expired. Scan your table's QR code again to notify the staff.",
    unavailable: "Notifying from here isn't possible right now. Raise your hand or find the staff.",
    created: { waiter: "We've notified the staff. Someone will be with you shortly.", bill: "We've requested your check. It will be brought over shortly." },
    already: { waiter: "We've already notified the staff. Someone will be right with you.", bill: "We've already requested your check. It's on its way." },
    cooldown: (s) => `You just notified us a moment ago. You can notify again in ${s} ${s === 1 ? "second" : "seconds"}.`,
    rateLimited: (m) => `Too many notifications were sent from your connection. Try again in ${m} ${m === 1 ? "minute" : "minutes"}.`,
  },
  account: {
    view: "View my check",
    title: "Your check",
    loading: "Looking up your check…",
    error: "We couldn't show your check. Please ask your waiter.",
    empty: "Nothing has been added to your table yet.",
    total: "Total so far",
    consumed: "Consumption total",
    tipSuggested: "Suggested tip",
    tipTotal: "Total with suggested tip",
    tipOptional: "Tipping is optional",
    dishes: (n) => (n === 1 ? "1 dish" : `${n} dishes`),
    each: (price) => `${price} each`,
    legend: "Not valid as an invoice",
    note: "This is what has been added so far: your waiter may add more. The staff confirms the final amount.",
    asOf: (time) => `Updated at ${time}`,
    refresh: "Refresh",
    close: "Close",
  },
  feed: {
    link: "Watch Menufeed",
    dockLink: "Menufeed",
    pageTitle: (organization) => `Menufeed from ${organization}`,
    heading: "Menufeed",
    back: "Back to the menu",
    position: (n, total) => `Video ${n} of ${total}`,
    mute: "Mute",
    unmute: "Turn sound on",
    play: "Play",
    pause: "Pause",
    viewDish: "View dish",
    hideDish: "Close",
    videoError: "This video could not be played.",
    emptyTitle: "No videos yet",
    emptyHint: "When the restaurant publishes videos, you will see them here. In the meantime, have a look at the menu.",
    nextVideo: "Next video",
    previousVideo: "Previous video",
    like: "Like",
    unlike: "Remove like",
    likeCount: (n) => `${n} ${n === 1 ? "like" : "likes"}`,
    likeError: "We couldn't save your like. Please try again in a moment.",
    comments: "Comments",
    commentsCount: (n) => `${n} ${n === 1 ? "comment" : "comments"}`,
    closeComments: "Close comments",
    commentsEmpty: "No comments yet.",
    commentsMore: "Show more comments",
    commentsRetry: "Try again",
    commentsLoading: "Loading…",
    commentsLoadError: "We couldn't load the comments. Please try again in a moment.",
    anonymous: "Anonymous",
    commentAliasLabel: "Your name (optional)",
    commentBodyLabel: "Your comment",
    commentPlaceholder: "Tell us what you thought",
    commentCounter: (used, max) => `${used} of ${max}`,
    commentWrite: "Write a comment",
    commentCancel: "Cancel",
    commentSend: "Send comment",
    commentSending: "Sending…",
    commentSent: "Thank you. Your comment will be published once the restaurant approves it.",
    commentInvalid: "Write a comment of up to 280 characters and a name of up to 30.",
    commentQueueFull: "The restaurant has many comments to review. Please try again later.",
    commentRateLimited: (m) => `Too many comments were sent in a short time. Try again in ${m} ${m === 1 ? "minute" : "minutes"}.`,
    commentError: "We couldn't send your comment. Please try again in a moment.",
  },
  unavailable: {
    suspendedTitle: "Menu temporarily unavailable",
    suspendedBody: "The restaurant is updating its service. Ask the staff if you'd like to see the menu now.",
    inactiveTitle: "This location is not available",
    inactiveBody: "This location is not serving right now. Ask the staff if you'd like to see the menu now.",
  },
};

const pt: Textos = {
  cartaDe: (organization) => `Cardápio de ${organization}`,
  notFoundTitle: "Cardápio não encontrado",
  unavailableTitle: (organization) => `${organization} · Cardápio indisponível`,
  branch: (name) => `Unidade ${name}`,
  logoAlt: (organization) => `Logo de ${organization}`,
  emptyTitle: "Este cardápio ainda não tem pratos.",
  emptyHint: "Volte a conferir em alguns minutos.",
  footerAllergens: "Este cardápio não informa os alérgenos de cada prato: um prato sem etiqueta não está declarado como adequado a nenhuma dieta. Se você tem alergia, intolerância ou doença celíaca, pergunte à equipe antes de pedir.",
  detailAllergens: "Se você tem alergia, intolerância ou doença celíaca, pergunte à equipe antes de pedir. Um prato sem etiqueta não é necessariamente adequado para você.",
  madeWith: "Feito com UcoMenu",
  languageLabel: "Idioma",
  review: { footer: "Deixe sua avaliação no Google", invite: "Se quiser, você pode deixar uma avaliação deste lugar no Google.", action: "Deixar uma avaliação", close: "Fechar" },
  legal: { nav: "Informações legais", terms: "Termos de uso", privacy: "Privacidade", allergens: "Aviso de alérgenos" },
  count: {
    dishes: (n) => (n === 1 ? "1 prato" : `${n} pratos`),
    status: (n, filtering) => `${n === 1 ? "1 prato" : `${n} pratos`}${filtering ? (n === 1 ? " encontrado" : " encontrados") : " no cardápio"}`,
  },
  search: {
    region: "Buscar e filtrar o cardápio",
    label: "Buscar pratos",
    placeholder: "Nome ou descrição",
    tagsLegend: "Etiquetas declaradas pelo estabelecimento",
    tagsNotice: "Etiquetas declaradas pelo estabelecimento, não certificadas: se você tem alergias ou doença celíaca, pergunte à equipe antes de pedir.",
    allTags: "Mostrando os pratos que têm todas as etiquetas escolhidas.",
    allergenLink: "Aviso de alérgenos",
    clear: "Limpar busca e filtros",
    emptyTitle: "Não encontramos pratos com essa busca.",
    emptyHint: "Tente outro nome ou remova algum filtro.",
    emptyHintTags: "Não aparecerem pratos não significa que o estabelecimento não tenha opções para a sua dieta: pergunte à equipe.",
  },
  dietary: { gluten_free: "Sem glúten", vegan: "Vegano", vegetarian: "Vegetariano", list: "Etiquetas alimentares declaradas pelo estabelecimento" },
  categories: { index: "Categorias do cardápio", bar: "Mudar de categoria" },
  dish: {
    soldOut: "Esgotado",
    soldOutBranch: "Esgotado nesta unidade",
    tagsNote: "Etiqueta declarada pelo estabelecimento, não certificada. Pode haver contato com outros ingredientes durante o preparo.",
    tagsOptionsNote: "Opções e adicionais podem mudar estas etiquetas: pergunte à equipe antes de escolhê-los.",
    photoAlt: (name) => `Foto de ${name}`,
    viewDetail: (name) => `Ver detalhes de ${name}`,
    back: "Voltar ao cardápio",
  },
  promo: {
    was: "Preço anterior",
    until: (time, day, date) => {
      if (day === "today") return `Até às ${time}`;
      if (day === "tomorrow") return time === "00:00" ? "Até a meia-noite" : `Até às ${time} de amanhã`;
      return `Até ${date} às ${time}`;
    },
  },
  options: {
    rule: (min, max) => {
      if (min === 0) return `Opcional · até ${max}`;
      if (min === max) return `Escolha ${min}`;
      return `Escolha de ${min} a ${max}`;
    },
    more: (n) => (n === 1 ? "mais 1 opção nos detalhes" : `mais ${n} opções nos detalhes`),
  },
  call: {
    form: "Avisar a equipe",
    waiter: "Chamar o garçom",
    bill: "Pedir a conta",
    sending: "Enviando…",
    expired: "Esta sessão expirou. Escaneie de novo o QR da sua mesa para avisar a equipe.",
    unavailable: "No momento não é possível avisar por aqui. Levante a mão ou procure a equipe.",
    created: { waiter: "Avisamos a equipe. Em instantes alguém atende você.", bill: "Pedimos a sua conta. Em instantes ela chega até você." },
    already: { waiter: "Já avisamos a equipe. Já já alguém atende você.", bill: "Já pedimos a sua conta. Ela chega já já." },
    cooldown: (s) => `Você acabou de avisar. Pode avisar de novo em ${s} ${s === 1 ? "segundo" : "segundos"}.`,
    rateLimited: (m) => `Foram feitos avisos demais a partir da sua conexão. Tente de novo em ${m} ${m === 1 ? "minuto" : "minutos"}.`,
  },
  account: {
    view: "Ver minha conta",
    title: "Sua conta",
    loading: "Buscando a sua conta…",
    error: "Não conseguimos mostrar a sua conta. Peça ao garçom.",
    empty: "Ainda não há pratos anotados na sua mesa.",
    total: "Total até agora",
    consumed: "Total do consumo",
    tipSuggested: "Gorjeta sugerida",
    tipTotal: "Total com gorjeta sugerida",
    tipOptional: "A gorjeta é opcional",
    dishes: (n) => (n === 1 ? "1 prato" : `${n} pratos`),
    each: (price) => `${price} cada`,
    legend: "Sem valor fiscal",
    note: "É o que foi anotado até agora: o garçom pode acrescentar mais. O valor final é confirmado pela equipe.",
    asOf: (time) => `Atualizada às ${time}`,
    refresh: "Atualizar",
    close: "Fechar",
  },
  feed: {
    link: "Ver Menufeed",
    dockLink: "Menufeed",
    pageTitle: (organization) => `Menufeed de ${organization}`,
    heading: "Menufeed",
    back: "Voltar ao cardápio",
    position: (n, total) => `Vídeo ${n} de ${total}`,
    mute: "Silenciar",
    unmute: "Ativar o som",
    play: "Reproduzir",
    pause: "Pausar",
    viewDish: "Ver prato",
    hideDish: "Fechar",
    videoError: "Não foi possível reproduzir este vídeo.",
    emptyTitle: "Ainda não há vídeos",
    emptyHint: "Quando o estabelecimento publicar vídeos, você os verá aqui. Enquanto isso, veja o cardápio.",
    nextVideo: "Próximo vídeo",
    previousVideo: "Vídeo anterior",
    like: "Curtir",
    unlike: "Remover curtida",
    likeCount: (n) => `${n} ${n === 1 ? "curtida" : "curtidas"}`,
    likeError: "Não foi possível registrar sua curtida. Tente novamente em instantes.",
    comments: "Comentários",
    commentsCount: (n) => `${n} ${n === 1 ? "comentário" : "comentários"}`,
    closeComments: "Fechar os comentários",
    commentsEmpty: "Ainda não há comentários.",
    commentsMore: "Ver mais comentários",
    commentsRetry: "Tentar novamente",
    commentsLoading: "Carregando…",
    commentsLoadError: "Não foi possível carregar os comentários. Tente novamente em instantes.",
    anonymous: "Anônimo",
    commentAliasLabel: "Seu nome (opcional)",
    commentBodyLabel: "Seu comentário",
    commentPlaceholder: "Conte o que você achou",
    commentCounter: (used, max) => `${used} de ${max}`,
    commentWrite: "Escrever um comentário",
    commentCancel: "Cancelar",
    commentSend: "Enviar comentário",
    commentSending: "Enviando…",
    commentSent: "Obrigado. Seu comentário será publicado quando o restaurante aprovar.",
    commentInvalid: "Escreva um comentário de até 280 caracteres e um nome de até 30.",
    commentQueueFull: "O restaurante tem muitos comentários para revisar. Tente novamente mais tarde.",
    commentRateLimited: (m) => `Muitos comentários foram enviados em pouco tempo. Tente novamente em ${m} ${m === 1 ? "minuto" : "minutos"}.`,
    commentError: "Não foi possível enviar seu comentário. Tente novamente em instantes.",
  },
  unavailable: {
    suspendedTitle: "Cardápio temporariamente indisponível",
    suspendedBody: "O estabelecimento está atualizando seu serviço. Pergunte à equipe se quiser ver o cardápio agora.",
    inactiveTitle: "Esta unidade não está disponível",
    inactiveBody: "Esta unidade não está atendendo no momento. Pergunte à equipe se quiser ver o cardápio agora.",
  },
};

export const TEXTOS: Record<Lang, Textos> = { es, en, pt };
