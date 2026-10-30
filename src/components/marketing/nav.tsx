import Link from "next/link";
import { Mark } from "@/components/panel/mark";
import { WhatsappLink } from "./whatsapp-link";

const ENLACES = [
  ["#como-funciona", "Cómo funciona"],
  ["#para-tu-local", "Para tu local"],
  ["#precios", "Precios"],
  ["#preguntas", "Preguntas"],
] as const;

export function Nav() {
  return (
    <div className="mk-nav">
      <a href="#contenido" className="mk-skip">
        Saltar al contenido
      </a>
      <nav className="mk-nav-bar" aria-label="Principal">
        <Link href="/" className="mk-brand">
          <Mark />
          UcoMenu
        </Link>
        <div className="mk-nav-links">
          {ENLACES.map(([href, texto]) => (
            <a key={href} href={href}>
              {texto}
            </a>
          ))}
        </div>
        <div className="mk-nav-end">
          <Link href="/login" className="mk-login">
            Ingresar
          </Link>
          <WhatsappLink className="mk-btn mk-btn-sm">Probalo gratis</WhatsappLink>
        </div>
      </nav>
    </div>
  );
}
