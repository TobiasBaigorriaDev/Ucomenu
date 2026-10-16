---
name: ciclo-revision-codex
description: Usar cuando un cambio de nivel C (o M con duda, o si el usuario lo pide) necesita la revisión independiente de Codex y se quiere automatizar «implemento → Codex revisa → corrijo → Codex verifica» sin copiar mensajes. Ejecuta `pnpm revision:codex` (Codex CLI en solo lectura), lee el veredicto y corrige. No reemplaza la aprobación humana de los cambios C.
---

# ciclo-revision-codex

Solo de Claude Code (no se sincroniza con Codex). Automatiza la **revisión independiente** que `AGENTS.md` exige en el nivel C. El revisor es Codex CLI en solo lectura; el implementador es esta sesión.

## Cuándo
- **C:** siempre, una vez que la implementación y sus pruebas por impacto están listas y confirmadas en un commit.
- **M:** solo con duda real o si el usuario lo pide. **S:** no.
- Si la sesión de Codex ya está abierta en otro panel y el usuario prefiere eso, no usar este ciclo.

## Ronda 1
1. Dejar el cambio **confirmado** (commit local) con la ficha al día: aceptación, evidencia ya obtenida, invariantes. El revisor lee la ficha y el diff, no esta conversación.
2. Ejecutar (tarda varios minutos; correr en segundo plano y esperar el aviso):
   ```bash
   pnpm revision:codex --commit HEAD --ficha agile/cambios/<ficha>.md --nivel C
   ```
   Alcances alternativos: `--base main` (toda una rama) o `--uncommitted` (pendientes y archivos nuevos). `--dry-run` muestra el pedido sin llamar a Codex.
3. Código de salida: **0** aprobar · **1** aprobar con cambios · **2** rechazar · **3** error (Codex ausente, tiempo agotado, sin línea `VEREDICTO:`). El informe queda en `output/revisiones/` (ignorado por Git) y se imprime.

## Triage antes de corregir
Un hallazgo es una hipótesis hasta reproducirla. Para cada uno: **leer el código citado y reproducirlo** (prueba que falle, consulta o razonamiento verificable).
- Real → corregir con **prueba de regresión que falle sin la corrección** (en C, comprobarlo rompiendo la defensa).
- Falso o discutible → no aplicarlo; anotar por qué en la ficha y, si es de negocio o datos, preguntar al usuario.
- Sugerencias de estilo: ignorar. Sin bucles por estilo.

## Ronda de verificación
Tras corregir y confirmar (nuevo commit), **una** ronda más:
```bash
pnpm revision:codex --commit HEAD --ficha agile/cambios/<ficha>.md --nivel C \
  --verificar --hallazgos output/revisiones/<informe-de-la-ronda-1>.md
```
Codex comprueba hallazgo por hallazgo y busca regresiones del diff nuevo; no amplía el alcance. Si vuelve con cambios: corregir una vez más y verificar; **a la tercera ronda sin aprobar, parar y consultar al usuario** (probablemente el diseño, no el detalle).

## Registro y cierre
- En la ficha (sección «Revisión y aprobación»): rondas, hallazgos (reales/descartados y por qué), veredicto final y commit revisado. No pegar el informe completo.
- Para el nivel C, el veredicto de Codex **no es** la aprobación del usuario: pedirla aparte para lo peligroso (borrados, dinero, permisos).
- Anotar en `agile/ahora.md` solo si queda algo pendiente.

## Reglas
- Codex corre con `-s read-only --ephemeral`: no edita ni guarda sesión. Igual puede leer el repo; el pedido le prohíbe abrir `.env*` y secretos.
- El script envía código del repositorio al servicio de Codex con la cuenta del usuario: no usarlo si el diff contiene secretos o datos reales de clientes.
- Un worktree, un escritor: mientras corre la revisión, no editar el código revisado (el informe corresponde a ese commit).
- No lanzar dos revisiones a la vez sobre la misma base de datos local si alguna ejecuta pruebas; la de Codex no debería, pero si lo hiciera, RLS y E2E comparten base.
