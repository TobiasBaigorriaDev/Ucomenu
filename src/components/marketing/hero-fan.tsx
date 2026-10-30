"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { IMG } from "./imagenes";
import { Phone } from "./phone";

// El orden empieza con la composición actual: Bruma al centro, la carta PDF a la izquierda y La Bestia a la derecha.
const phones = [
  { img: IMG.bruma, desktop: "mk-p-c" },
  { img: IMG.laBestia, desktop: "mk-p-r1" },
  { img: IMG.patioOliva, desktop: "mk-p-r2" },
  { img: IMG.aurelia, desktop: "mk-p-l2" },
  { img: IMG.cafePdf, desktop: "mk-p-l1" },
] as const;
const positions = ["centro", "derecha", "fuera-derecha", "fuera-izquierda", "izquierda"] as const;

export function HeroFan() {
  const fan = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const [canMove, setCanMove] = useState(false);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 640px)");
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const update = () => setCanMove(mobile.matches && motion.matches);
    update();
    mobile.addEventListener("change", update);
    motion.addEventListener("change", update);
    return () => { mobile.removeEventListener("change", update); motion.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    const element = fan.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canMove || !visible) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setActive((current) => (current + 1) % phones.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [canMove, visible]);

  return (
    <div className="mk-fan-wrap">
      <div className="mk-fan" ref={fan}>
        {phones.map(({ img, desktop }, index) => (
          <div key={img.src} className="mk-fan-item" data-position={positions[(index - active + phones.length) % phones.length]}>
            <Phone img={img} className={desktop} sizes="(max-width: 640px) 62vw, (min-width: 1100px) 300px, 28vw" priority={index === 0} />
          </div>
        ))}
        <Image src={IMG.llamadoLlama.src} alt={IMG.llamadoLlama.alt} width={IMG.llamadoLlama.w} height={IMG.llamadoLlama.h} sizes="(min-width: 1100px) 330px, 56vw" className="mk-float mk-float-a" />
        <Image src={IMG.llamadoCuenta.src} alt={IMG.llamadoCuenta.alt} width={IMG.llamadoCuenta.w} height={IMG.llamadoCuenta.h} sizes="(min-width: 1100px) 330px, 56vw" className="mk-float mk-float-b" />
      </div>
    </div>
  );
}
