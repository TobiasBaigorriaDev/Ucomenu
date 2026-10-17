param([switch]$DryRun)

# Recordatorio local: no crea proyectos, no restaura datos ni lee credenciales.
$ErrorActionPreference = 'Stop'
$message = @'
Corresponde ensayar la restauracion mensual de UcoMenu en un proyecto Supabase nuevo.

Seguir docs/operacion.md, seccion 2. Verificar el manifiesto, restaurar en un destino aislado y comprobar cuentas, recuentos y fotos. Registrar la evidencia en agile/cambios/salida-a-produccion.md.

Este aviso no ejecuta restauraciones ni genera costos.
'@

if ($DryRun) {
    Write-Output $message
    exit 0
}

$shell = New-Object -ComObject WScript.Shell
$null = $shell.Popup($message, 300, 'UcoMenu - ensayo mensual de restauracion', 64)
