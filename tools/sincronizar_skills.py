#!/usr/bin/env python3
"""Mantiene sincronizadas las cuatro skills Agile entre Codex (.agents/skills) y Claude Code (.claude/skills).

Solo trabaja con las skills de SKILLS. Otras skills o plugins (p. ej. Impeccable) no se comparan, copian ni modifican.

Uso (desde la raíz del proyecto):
    python tools/sincronizar_skills.py --check         # solo comprueba; código de salida 1 si hay divergencias
    python tools/sincronizar_skills.py                  # copia .agents/skills -> .claude/skills (fuente: .agents)
    python tools/sincronizar_skills.py --desde claude   # copia .claude/skills -> .agents/skills
    python tools/sincronizar_skills.py --raiz <carpeta> # usa otra raíz (p. ej. una copia temporal para probar)

No usa red ni dependencias externas. No borra archivos que solo existen en el destino (los informa).
"""
import argparse
import hashlib
import shutil
import sys
from pathlib import Path

SKILLS = ("agile-explorar", "agile-iterar", "agile-revisar", "agile-descubrir-skills")
RAIZ = Path(__file__).resolve().parent.parent


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def archivos(base: Path) -> dict:
    """Archivos de las skills de SKILLS dentro de base, como {'<skill>/<ruta>': Path}."""
    res = {}
    for nombre in SKILLS:
        carpeta = base / nombre
        if carpeta.is_dir():
            for p in carpeta.rglob("*"):
                if p.is_file():
                    res[p.relative_to(base).as_posix()] = p
    return res


def comparar(origen: Path, destino: Path):
    a, b = archivos(origen), archivos(destino)
    faltan = sorted(set(a) - set(b))
    sobran = sorted(set(b) - set(a))
    distintos = sorted(k for k in set(a) & set(b) if digest(a[k]) != digest(b[k]))
    return a, faltan, sobran, distintos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="solo comprobar, sin copiar")
    ap.add_argument("--desde", choices=["agents", "claude"], default="agents", help="carpeta fuente (por defecto: agents)")
    ap.add_argument("--raiz", type=Path, default=RAIZ, help="raíz del proyecto (por defecto: la de este script)")
    args = ap.parse_args()

    raiz = args.raiz.resolve()
    agents, claude = raiz / ".agents" / "skills", raiz / ".claude" / "skills"
    origen, destino = (agents, claude) if args.desde == "agents" else (claude, agents)

    ausentes = [n for n in SKILLS if not (origen / n).is_dir()]
    if ausentes:
        print(f"ERROR: faltan en la carpeta fuente {origen}: {', '.join(ausentes)}", file=sys.stderr)
        return 2

    src, faltan, sobran, distintos = comparar(origen, destino)

    if args.check:
        if not (faltan or sobran or distintos):
            print(f"OK: las {len(SKILLS)} skills Agile estan sincronizadas.")
            return 0
        for k in faltan:
            print(f"FALTA en destino: {k}")
        for k in distintos:
            print(f"DIFIERE: {k}")
        for k in sobran:
            print(f"SOLO en destino: {k}")
        print("Ejecuta sin --check para sincronizar.")
        return 1

    copiados = 0
    for k in faltan + distintos:
        d = destino / k
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src[k], d)
        print(f"copiado: {k}")
        copiados += 1
    for k in sobran:
        print(f"AVISO: solo existe en destino (no se borra): {k}")
    print(f"Listo: {copiados} archivo(s) sincronizado(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
