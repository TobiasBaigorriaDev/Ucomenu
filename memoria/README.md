# Memoria persistente (OPCIONAL) — Engram

**Agile SDD funciona con Git y archivos Markdown, sin ningún servicio de memoria.** Engram es un piloto opcional recomendado desde la versión 1.1.1. Que esté documentado acá **no significa que esté instalado**.

## Tres capas de conocimiento
1. **Fuentes versionadas** (Git): el código/esquema muestran lo implementado; los requisitos y fichas **aceptados** describen lo esperado; las pruebas verifican comportamientos concretos. Si discrepan, investigar y resolver, no establecer que siempre gana uno.
2. **Handoff operativo**: `agile/ahora.md`. Debe leerse aunque Engram falle.
3. **Memoria Engram (opcional)**: recuerdos selectivos por proyecto (decisiones, bugs complejos resueltos, convenciones, hallazgos costosos de repetir). **No** es fuente de verdad.

Si código, ficha y memoria discrepan: revisar evidencia, determinar cuál está vigente y **actualizar la fuente apropiada**. Nunca imponer un recuerdo sobre una especificación válida.

## Contrato de uso con los agentes
- **Al empezar un trabajo relevante:** confirmar el proyecto activo y recuperar solo decisiones pertinentes (`mem_current_project`, `mem_context`, `mem_search`, si están disponibles).
- **Antes de re-investigar un problema conocido:** buscar de forma focalizada y cotejar con código y Git.
- **Al decidir o resolver algo duradero:** guardar una nota breve (contexto, decisión, causa, archivos, límites) con `mem_save`. No guardar cada turno ni cada comando.
- **Al cerrar una sesión extensa:** actualizar `agile/ahora.md`; opcionalmente `mem_session_summary`.
- **Al cambiar de agente:** terminar o pausar, verificar Git, abrir el otro en el **mismo repo**, leer el handoff. Nunca delegación automática ni dos agentes editando el mismo worktree.

## Qué NO guardar
Secretos, credenciales, datos personales de clientes, volcados productivos, transcripciones completas.

## Instalación en Windows / PowerShell (opcional; no la ejecuta el kit)

**Fuentes oficiales y cambiantes:**
- Releases estables: https://github.com/Gentleman-Programming/engram/releases
- Instalación Windows: https://github.com/Gentleman-Programming/engram/blob/main/docs/INSTALLATION.md
- Configuración por agente: https://github.com/Gentleman-Programming/engram/blob/main/docs/AGENT-SETUP.md

1. Descargá el binario estable de Windows correspondiente a tu CPU (`windows_amd64` o `windows_arm64`) desde Releases. Extraé `engram.exe` en una carpeta confiable que esté en el `PATH`. Alternativa si ya usás Go: compilar desde el código fuente según la guía oficial. Si Windows bloquea el ejecutable, **no desactives Defender o Smart App Control**; comprobá procedencia y diagnóstico.
2. En PowerShell verificá las herramientas disponibles:

```powershell
engram version
codex --version
claude --version
Get-Command jq -ErrorAction SilentlyContinue
Get-Command curl.exe -ErrorAction SilentlyContinue
Get-Command bash.exe -ErrorAction SilentlyContinue
```

3. Para la configuración **completa con plugin y hooks de Claude Code**, la documentación oficial requiere **`jq` y `curl` en el PATH del shell usado por Claude**. En Windows `curl.exe` sirve para `curl`; Claude utiliza Git Bash/WSL para hooks Bash. Instalá/comprobá esas dependencias **antes** de ejecutar `engram setup claude-code`.
4. Configurá cada cliente desde una terminal donde ambos estén accesibles:

```powershell
engram setup codex
engram setup claude-code   # solo con jq y curl disponibles para los hooks
engram doctor
engram tui
```

`engram setup codex` puede requerir soporte para plugins en la versión actual del CLI; verificá los mensajes y no consideres completo un `setup` fallido. Después reiniciá **ambos** agentes. Si actualizás o movés `engram.exe`, es posible que necesites ejecutar de nuevo `setup` y reiniciar.

**Alternativa sin jq/curl para Claude Code:** usar *Bare MCP* (sin hooks ni captura automática), según la sección *Option C: Bare MCP* de la guía oficial. Por ejemplo, reemplazando la ruta por la ubicación real de tu ejecutable:

```powershell
claude mcp add --transport stdio --scope user engram -- "C:\Herramientas\Engram\engram.exe" mcp --tools=agent
```

No combines registros duplicados del servidor Engram. El modo MCP simple **no equivale** a la integración completa; verificá que Claude reciba instrucciones mínimas de recuperación después de compactar contexto. Ninguna de estas opciones es obligatoria para trabajar con Agile SDD.

## Prueba de aceptación antes de adoptarlo
1. Instalar en un proyecto de prueba sin secretos; `engram doctor` correcto.
2. Desde Codex guardar una decisión ficticia y verla en la TUI.
3. Cerrar Codex, abrir Claude Code en el mismo proyecto y recuperarla; repetir al revés.
4. Abrir un segundo repo y comprobar que **no se mezclan** recuerdos.
5. Cambiar la decisión aceptada en Git y comprobar que la memoria histórica no anula el requisito vigente.
6. Simular Engram caído y confirmar que se continúa con `agile/ahora.md`.
7. Comparar tiempo de retomada, tokens y defectos con/sin Engram.

**Adoptar solo si** funciona en ambos clientes, aísla proyectos, tiene permisos adecuados y aporta beneficio real. Si falla: desactivarlo y seguir con la metodología normal.

## Notas
- No instalar Engram y Claude-Mem a la vez al principio: duplican funciones y dificultan medir.
- Ni Engram ni las skills garantizan ahorro de tokens: medirlo por tarea terminada.
