// Categorías y platos que se SUMAN a los locales de demostración (los agrega `tools/ampliar-catalogo-demo.mjs`, sin borrar nada).
// Precios en centavos de peso (790000 = $7.900). Las fotos son claves de `FOTO` en `catalogo.mjs`.
import { GF, VG, VT } from "./catalogo.mjs";

export const AMPLIACIONES = {
  "patio-oliva": [
    { name: "Cafés", platos: [
      { name: "Espresso", desc: "Café de especialidad, corto e intenso.", price: 250000, foto: "espresso", tags: [VG, GF] },
      { name: "Latte", desc: "Espresso con leche vaporizada y arte latte.", price: 380000, foto: "latteArt", tags: [VT, GF] },
      { name: "Capuchino", desc: "Espresso, leche texturizada y espuma cremosa.", price: 390000, foto: "cafes", tags: [VT, GF] },
      { name: "Cold brew", desc: "Café infusionado en frío durante 18 horas, con hielo.", price: 450000, foto: "coldBrew", tags: [VG, GF] },
      { name: "Café de filtro", desc: "Grano de origen molido al momento, método V60.", price: 420000, foto: "granos", tags: [VG, GF] },
    ] },
    { name: "Desayunos y meriendas", platos: [
      { name: "Tostada con huevo", desc: "Pan de masa madre, huevo poché y palta.", price: 690000, foto: "tostadaHuevo", tags: [VT] },
      { name: "Desayuno completo", desc: "Café o té, jugo de naranja, tostadas y medialunas.", price: 990000, foto: "desayuno", tags: [VT] },
      { name: "Panqueques de la casa", desc: "Tres panqueques con frutos rojos y miel.", price: 750000, foto: "panqueques", tags: [VT] },
      { name: "Tostada francesa", desc: "Pan brioche dorado con canela, banana y dulce de leche.", price: 720000, foto: "frances", tags: [VT] },
    ] },
    { name: "Pastelería", platos: [
      { name: "Torta de chocolate", desc: "Bizcochuelo húmedo, ganache y cacao amargo.", price: 590000, foto: "tortaChocolate", tags: [VT] },
      { name: "Tarta de limón", desc: "Base crocante, crema de limón y merengue quemado.", price: 550000, foto: "tartaLimon", tags: [VT] },
      { name: "Tiramisú", desc: "Bizcochos de café, mascarpone y cacao.", price: 620000, foto: "tiramisu", tags: [VT] },
      { name: "Panna cotta", desc: "Crema de vainilla con salsa de frutos rojos.", price: 520000, foto: "pannaCotta", tags: [VT, GF] },
    ] },
    { name: "Medialunas y galletitas", platos: [
      { name: "Medialuna de manteca", desc: "Hojaldrada, horneada cada mañana.", price: 130000, foto: "medialuna", tags: [VT] },
      { name: "Cookies de chips", desc: "Dos cookies tibias con chips de chocolate.", price: 280000, foto: "cookies", tags: [VT] },
      { name: "Cookie gigante", desc: "Para compartir, con chocolate y nueces.", price: 380000, foto: "cookieGigante", tags: [VT] },
      { name: "Macarons", desc: "Caja de tres macarons de sabores de temporada.", price: 480000, foto: "macarons", tags: [VT, GF] },
      { name: "Crepes con dulce de leche", desc: "Crepes finos rellenos, con azúcar impalpable.", price: 680000, foto: "crepes", tags: [VT] },
    ] },
    { name: "Bebidas frías y licuados", platos: [
      { name: "Té helado", desc: "Té negro infusionado, limón y menta.", price: 320000, foto: "teHelado", tags: [VG, GF] },
      { name: "Shake de Oreo", desc: "Helado de vainilla, galletitas Oreo y crema.", price: 580000, foto: "shakeOreo", tags: [VT] },
      { name: "Licuado de frutilla", desc: "Frutillas frescas, leche y un toque de miel.", price: 550000, foto: "shakeFrutilla", tags: [VT, GF] },
      { name: "Paletas heladas de fruta", desc: "Dos paletas de fruta natural, sin conservantes.", price: 340000, foto: "paletas", tags: [VG, GF] },
    ] },
  ],
  "fuego-andino": [
    { name: "Sándwiches a la parrilla", platos: [
      { name: "Hamburguesa andina", desc: "Medallón de 180 g, queso, cebolla asada y salsa de la casa.", price: 1890000, foto: "burger" },
      { name: "Sándwich de bondiola", desc: "Bondiola braseada, rúcula y mayonesa de ajo en pan de campo.", price: 1690000, foto: "bondiola" },
      { name: "Pancho ahumado", desc: "Salchicha ahumada a las brasas con cebolla crocante.", price: 990000, foto: "perro" },
      { name: "Papas cajún", desc: "Para acompañar, con salsa de la casa.", price: 850000, foto: "papasCajun", tags: [VT] },
    ] },
    { name: "Postres y bebidas", platos: [
      { name: "Tarta de limón", desc: "Base crocante, crema de limón y merengue.", price: 890000, foto: "tartaLimon", tags: [VT] },
      { name: "Helado con dulce de leche", desc: "Dos bochas de helado artesanal y dulce de leche.", price: 790000, foto: "helado", tags: [VT, GF] },
      { name: "Cerveza artesanal", desc: "Pinta de cerveza rubia de la casa.", price: 790000, foto: "pinta", tags: [VG] },
      { name: "Copa de Cabernet", desc: "Cabernet Sauvignon de Mendoza por copa.", price: 890000, foto: "cabernet", tags: [VG] },
      { name: "Old fashioned", desc: "Whisky, azúcar, amargo de angostura y cáscara de naranja.", price: 1190000, foto: "oldFashioned", tags: [VG] },
    ] },
  ],
};
