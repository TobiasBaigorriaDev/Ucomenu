#!/usr/bin/env python3
"""Mantiene sincronizadas las skills de Codex (.agents/skills) y Claude Code (.claude/skills).

Uso (desde la raíz del proyecto):
    python tools/sincronizar_skills.py --check         # solo comprueba; código de salida 1 si hay divergencias
    python tools/sincronizar_skills.py                  # copia .agents/skills -> .claude/skills (fuente: .agents)
    python tools/sincronizar_skills.py --desde claude   # copia .claude/skills -> .agents/skills

No usa red ni dependencias externas. No borra skills que solo existen en el destino (las informa).
"""
import argparse
import hashlib
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
AGENTS = RAIZ / ".agents" / "skills"
CLAUDE = RAIZ / ".claude" / "skills"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def archivos(base: Path) -> dict:
    if not base.is_dir():
        return {}
    return {p.relative_to(base).as_posix(): p for p in base.rglob("*") if p.is_file()}


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
    args = ap.parse_args()

    origen, destino = (AGENTS, CLAUDE) if args.desde == "agents" else (CLAUDE, AGENTS)
    if not origen.is_dir():
        print(f"ERROR: no existe la carpeta fuente: {origen}", file=sys.stderr)
        return 2

    src, faltan, sobran, distintos = comparar(origen, destino)

    if args.check:
        if not (faltan or sobran or distintos):
            print("OK: las skills estan sincronizadas.")
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
