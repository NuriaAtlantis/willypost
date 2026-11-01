# WillyPost - para el servidor (y el túnel de medios). Lo usa detener.bat.
. (Join-Path $PSScriptRoot 'lib.ps1')
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Write-Host ''
if ($global:DryRun) { Write-Dry 'Parar el servidor de WillyPost (puerto 4747) y el túnel de medios'; exit 0 }
if (Stop-WillyPostServer $root) {
    Write-Host '  WillyPost se ha detenido. Para volver a abrirlo, usa el icono "WillyPost".' -ForegroundColor Green
} else {
    Write-Host '  WillyPost no estaba en marcha.' -ForegroundColor Gray
}
Write-Host ''
