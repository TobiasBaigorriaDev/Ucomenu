/**
 * Tabla de casos del enlace de reseñas, compartida con la prueba de RLS (`enlace-de-resenas.rls.test.ts`): la validación local y
 * el CHECK de la base tienen que responder lo mismo a cada fila.
 */
export const REVIEW_LINK_CASES: { url: string; valid: boolean }[] = [
  { url: "https://g.page/r/CabcdEFGH1234/review", valid: true },
  { url: "https://search.google.com/local/writereview?placeid=ChIJ123abc", valid: true },
  { url: "https://maps.app.goo.gl/AbCdEf12345", valid: true },
  { url: "https://goo.gl/maps/AbCdEf12345", valid: true },
  { url: "https://g.co/kgs/abc123", valid: true },
  { url: "https://share.google/abc123", valid: true },
  { url: "https://www.google.com/maps/place/Cafe+Ejemplo/@-34.6,-58.4,17z", valid: true },
  { url: "https://www.google.com.ar/maps?cid=123456789", valid: true },
  { url: "https://maps.google.com/?cid=123456789", valid: true },
  { url: "https://google.com/maps", valid: true },
  { url: "HTTPS://G.PAGE/r/abc/review", valid: true },
  { url: "https://g.page", valid: true },
  { url: "http://g.page/r/abc/review", valid: false },
  { url: "//g.page/r/abc/review", valid: false },
  { url: "g.page/r/abc/review", valid: false },
  { url: "javascript:alert(1)", valid: false },
  { url: "https://evil.com/g.page/r/abc/review", valid: false },
  { url: "https://g.page.evil.com/r/abc", valid: false },
  { url: "https://evilg.page/r/abc", valid: false },
  { url: "https://g.page@evil.com/r/abc", valid: false },
  { url: "https://evil.com@g.page/r/abc", valid: false },
  { url: "https://g.page:443/r/abc", valid: false },
  { url: "https://g.page?x=1", valid: false },
  { url: "https://g.page#x", valid: false },
  { url: "https://google.com.evil.com/maps", valid: false },
  { url: "https://notgoogle.com/maps", valid: false },
  { url: "https://accounts.google.com/o/oauth2/auth", valid: false },
  { url: "https://docs.google.com/forms/d/abc", valid: false },
  { url: "https://g.page/r/abc review", valid: false },
  { url: "https://g.page/r/abc\nreview", valid: false },
  { url: "https://g.page/r/abc\\review", valid: false },
  { url: "https://g.page/" + "a".repeat(500), valid: false },
];

