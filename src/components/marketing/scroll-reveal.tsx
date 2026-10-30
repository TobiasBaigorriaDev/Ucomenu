"use client";

import { useEffect } from "react";

// Un solo observador para las piezas de contenido; sin clases que oculten contenido antes de hidratar.
const TARGETS = [
  ".mk-presentacion-intro", ".mk-presentacion-video", ".mk-control > .mk-cell", ".mk-bento > .mk-cell",
  ".mk-step", ".mk-estilos", ".mk-demo-grid", ".mk-plan", ".mk-faq", ".mk-cierre .mk-wrap",
].join(", ");

export function ScrollReveal() {
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!("IntersectionObserver" in window) || !("animate" in Element.prototype)) return;
    const running = new Set<Animation>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        if (motion.matches || element.contains(document.activeElement)) continue;
        const animation = element.animate(
          [{ opacity: 0.88, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
        running.add(animation);
        animation.onfinish = () => running.delete(animation);
        animation.oncancel = () => running.delete(animation);
      }
    }, { threshold: 0, rootMargin: "0px 0px -40px 0px" });

    // Lo que ya está a la vista al cargar no salta ni espera una animación.
    document.querySelectorAll<HTMLElement>(TARGETS).forEach((element) => {
      if (element.getBoundingClientRect().top >= window.innerHeight) observer.observe(element);
    });
    const stopForReducedMotion = () => {
      if (motion.matches) running.forEach((animation) => animation.cancel());
    };
    motion.addEventListener("change", stopForReducedMotion);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", stopForReducedMotion);
      running.forEach((animation) => animation.cancel());
    };
  }, []);
  return null;
}
