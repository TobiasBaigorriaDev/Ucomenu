/**
 * Locales de demostración del STAGING (los carga `tools/sembrar-demo-staging.mjs`): una hamburguesería-bar en estilo Afiche y
 * un restaurante de alta cocina en estilo Minimal. Datos ficticios; fotos de Unsplash (ver `catalogo.mjs`). Precios en
 * centavos de ARS. Los ids de organización y sucursal son fijos para que la carga sea idempotente.
 */
import { GF, VG, VT } from "./catalogo.mjs";

const EXTRAS = { name: "Extras", min: 0, max: 3, opciones: [["Bacon crocante", 180000], ["Huevo frito", 120000], ["Cheddar extra", 100000], ["Medallón extra", 350000]] };
const ESTILO = { name: "Estilo", min: 1, max: 1, opciones: [["IPA", 0], ["Honey", 0], ["Stout", 0]] };
const COCCION = { name: "Punto de cocción", min: 1, max: 1, opciones: [["Jugoso", 0], ["A punto", 0], ["Cocido", 0]] };
const PRESENTACION = { name: "Presentación", min: 1, max: 1, opciones: [["Copa", 0], ["Botella", 7500000]] };

export const LOCALES = [
  {
    slug: "la-bestia",
    name: "La Bestia Burger & Bar",
    org: "b0000000-0000-4000-8000-000000000001",
    branch: "b1000000-0000-4000-8000-000000000001",
    prefix: { cat: "b2", prod: "b3", grp: "b4", opt: "b5" },
    layout: "afiche",
    palette: "carbon",
    logo: { fondo: "#d4a54a", trazo: "#161412", glifo: "hamburguesa" },
    categorias: [
      {
        name: "Burgers",
        platos: [
          { name: "La Bestia", desc: "Doble smash de 90 g, cheddar, pickles, cebolla caramelizada y salsa Bestia en pan brioche.", price: 1590000, foto: "bestia", grupos: [EXTRAS] },
          { name: "Clásica", desc: "Medallón de 150 g, cheddar, lechuga, tomate y mayo de la casa.", price: 1180000, foto: "clasica", grupos: [EXTRAS] },
          { name: "Doble bacon", desc: "Doble medallón, bacon ahumado crocante, cheddar y salsa BBQ.", price: 1690000, foto: "dobleBacon", grupos: [EXTRAS] },
          { name: "Doble cheddar", desc: "Cuatro fetas de cheddar derretido, cebolla grillada y mostaza dulce, en pan con sésamo.", price: 1590000, foto: "dobleCheddar", grupos: [EXTRAS] },
          { name: "Smash pickles", desc: "Smash doble con cheddar, pickles de la casa y salsa de mostaza y miel.", price: 1390000, foto: "smash", grupos: [EXTRAS] },
          { name: "Diabla", desc: "Jalapeños, pepper jack y salsa de ají ahumado. Pica de verdad.", price: 1450000, foto: "diabla",
            grupos: [{ name: "Nivel de picante", min: 1, max: 1, opciones: [["Medio", 0], ["Alto", 0], ["Infernal", 0]] }] },
          { name: "Crispy chicken", desc: "Pollo crocante, repollo morado, pepinillos y mayo picante.", price: 1340000, foto: "hamburguesa" },
          { name: "Veggie de garbanzos y hongos", desc: "Medallón casero de garbanzos y hongos, rúcula, tomate y mayo de ajo asado.", price: 1290000, tags: [VT] },
        ],
      },
      {
        name: "Para compartir",
        platos: [
          { name: "Trío de sliders", desc: "Tres mini burgers: clásica, bacon y picante, con pickles.", price: 1750000, foto: "sliders" },
          { name: "Alitas BBQ", desc: "Alitas laqueadas con salsa BBQ ahumada y dip de queso azul.", price: 1390000, foto: "alitas",
            grupos: [{ name: "Cantidad", min: 1, max: 1, opciones: [["6 unidades", 0], ["12 unidades", 1000000]] }] },
          { name: "Tiras de pollo crocante", desc: "Pechuga empanizada en panko, con mayo de limón.", price: 1240000, foto: "tiras" },
          { name: "Perro Bestia", desc: "Salchicha ahumada, cheddar, panceta crocante, cebolla frita y salsa de la casa.", price: 1090000, foto: "perro", agotado: true },
        ],
      },
      {
        name: "Papas y aros",
        platos: [
          { name: "Papas con parmesano", desc: "Papas fritas con parmesano rallado y perejil.", price: 890000, foto: "papasParmesano", tags: [VT] },
          { name: "Papas cajún", desc: "Fritas, con mezcla de especias cajún.", price: 760000, foto: "papasCajun", tags: [VG] },
          { name: "Aros de cebolla", desc: "En rebozado de cerveza, con salsa ranch.", price: 790000, foto: "aros", tags: [VT] },
          { name: "Papas Bestia", desc: "Papas fritas con cheddar fundido, panceta y cebolla de verdeo.", price: 1190000 },
        ],
      },
      {
        name: "Cervezas y tragos",
        platos: [
          { name: "Pinta tirada", desc: "Cerveza tirada de la canilla, 473 ml.", price: 690000, foto: "pinta", grupos: [ESTILO] },
          { name: "Jarra de 1,5 litros", desc: "Para compartir entre tres o cuatro.", price: 2190000, foto: "jarra", grupos: [ESTILO] },
          { name: "Cerveza en botella", desc: "Rubia o roja, bien fría.", price: 590000, foto: "botellas" },
          { name: "Mojito", desc: "Ron blanco, menta fresca, lima y soda.", price: 1050000, foto: "mojito" },
          { name: "Trago Bestia", desc: "Gin, frutos rojos, limón y albahaca. El de la casa.", price: 1150000, foto: "tragoBestia" },
          { name: "Fernet con cola", desc: "Clásico, con mucho hielo.", price: 880000 },
        ],
      },
      {
        name: "Shakes y dulces",
        platos: [
          { name: "Shake de Oreo", desc: "Helado de crema, galletitas Oreo y salsa de chocolate.", price: 1090000, foto: "shakeOreo", tags: [VT] },
          { name: "Shake de frutilla", desc: "Helado de crema y frutillas frescas.", price: 1050000, foto: "shakeFrutilla", tags: [VT, GF] },
          { name: "Cookie gigante", desc: "Tibia, con chips de chocolate y confites.", price: 590000, foto: "cookieGigante", tags: [VT] },
        ],
      },
    ],
  },
  {
    slug: "aurelia",
    name: "Aurelia Alta Cocina",
    org: "c0000000-0000-4000-8000-000000000001",
    branch: "c1000000-0000-4000-8000-000000000001",
    prefix: { cat: "c2", prod: "c3", grp: "c4", opt: "c5" },
    layout: "minimal",
    palette: "borgona",
    logo: { fondo: "#35151f", trazo: "#d9ab6b", glifo: "cloche" },
    categorias: [
      {
        name: "Entradas",
        platos: [
          { name: "Langostinos del Atlántico", desc: "Cuatro langostinos a la plancha, mantequilla de limón y brotes tiernos.", price: 2850000, foto: "langostinos", tags: [GF] },
          { name: "Gambas al ajillo", desc: "Gambas patagónicas, ajo confitado, guindilla y pan de campo tostado.", price: 2490000, foto: "gambas" },
          { name: "Panceta de cerdo glaseada", desc: "Cocción lenta de doce horas, puré de remolacha y chimichurri de la casa.", price: 2790000, foto: "platoAutor" },
          { name: "Tabla de quesos de autor", desc: "Cinco quesos madurados, nueces, higos y miel de abeja.", price: 2950000, foto: "quesos", tags: [VT] },
        ],
      },
      {
        name: "Principales",
        platos: [
          { name: "Medallón de lomo", desc: "Lomo angus de 220 g, reducción de Malbec, puré de apionabo y brócoli tierno.", price: 5890000, foto: "medallon", grupos: [COCCION] },
          { name: "Ojo de bife madurado", desc: "Cuarenta y cinco días de maduración, mantequilla de hierbas y papas confitadas.", price: 6450000, foto: "ojoBife", grupos: [COCCION] },
          { name: "Lomo a la parrilla con espárragos", desc: "Lomo sellado a las brasas, espárragos verdes y zanahorias glaseadas.", price: 5290000, foto: "lomoEsparragos", tags: [GF], grupos: [COCCION] },
          { name: "Salmón rosado", desc: "Salmón patagónico a la plancha, sofrito de vegetales y reducción de vino blanco.", price: 4690000, foto: "salmonFino", tags: [GF] },
          { name: "Pesca del día", desc: "Captura del día con manteca noisette, almendras y hierbas frescas.", price: 4890000, foto: "pesca" },
          { name: "Langostinos en bisque", desc: "Langostinos salteados sobre arroz cremoso de bisque, cebollino y aceite de crustáceos.", price: 4390000, foto: "bisque" },
          { name: "Arroz meloso de mariscos", desc: "Langostinos, mejillones y almejas, sofrito de pimientos y azafrán. Para dos personas.", price: 9800000, foto: "arrozMariscos", agotado: true },
        ],
      },
      {
        name: "Menú degustación",
        platos: [
          { name: "Menú degustación de 7 pasos", desc: "Recorrido de estación del chef, de la entrada al postre. Se sirve a toda la mesa.", price: 12900000, foto: "degustacion",
            grupos: [{ name: "Maridaje", min: 1, max: 1, opciones: [["Sin maridaje", 0], ["Maridaje de vinos", 4800000], ["Maridaje premium", 8900000]] }] },
          { name: "Menú degustación vegetariano de 5 pasos", desc: "Verduras de estación, hongos y quesos, con un postre de la casa.", price: 9400000, tags: [VT] },
        ],
      },
      {
        name: "Postres",
        platos: [
          { name: "Panna cotta de vainilla", desc: "Con frutillas frescas y coulis de frambuesa.", price: 1850000, foto: "pannaCotta", tags: [VT, GF] },
          { name: "Tarta de limón y merengue", desc: "Masa sablé, crema de limón y merengue flameado.", price: 1750000, foto: "tartaLimon", tags: [VT] },
          { name: "Macarons de la casa", desc: "Seis macarons de sabores de estación.", price: 1650000, foto: "macarons", tags: [VT, GF] },
          { name: "Tiramisú", desc: "Mascarpone, café de especialidad y cacao amargo.", price: 1790000, foto: "tiramisu", tags: [VT] },
          { name: "Bavarois de frambuesa", desc: "Bizcocho de pistacho, crema bávara y frambuesas.", price: 1890000, foto: "tortaFrambuesa", tags: [VT] },
          { name: "Crêpes con frutillas", desc: "Crêpes finas con crema chantilly y frutillas.", price: 1690000, foto: "crepes", tags: [VT] },
        ],
      },
      {
        name: "Vinos y coctelería",
        platos: [
          { name: "Espumante rosé", desc: "Método tradicional, burbuja fina. Copa.", price: 2450000, foto: "espumante" },
          { name: "Malbec Gran Reserva", desc: "Altura de Valle de Uco, doce meses en roble.", price: 2290000, foto: "malbec", tags: [VG], grupos: [PRESENTACION] },
          { name: "Cabernet Franc de altura", desc: "Frutos negros, especias y taninos sedosos.", price: 2390000, foto: "cabernet", tags: [VG], grupos: [PRESENTACION] },
          { name: "Old Fashioned reserva", desc: "Bourbon añejo, azúcar mascabo, amargo de angostura y piel de naranja flameada.", price: 2190000, foto: "oldFashioned" },
          { name: "Coctelería de autor", desc: "Preguntá por la creación de la semana de nuestro barman.", price: 2090000, foto: "cocteles" },
          { name: "Agua mineral importada (750 ml)", desc: "Con o sin gas.", price: 890000, tags: [VG, GF] },
        ],
      },
    ],
  },
];
