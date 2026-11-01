# WillyPost - desinstalador para Windows (lo lanza "Desinstalar WillyPost.bat").
# Quita los accesos directos, el arranque automático y la aplicación. Tus datos solo se borran si lo confirmas.
# DRYRUN=1 -> solo muestra lo que haría.   WILLYPOST_YES=1 -> responde "sí" a la primera pregunta.
# WILLYPOST_DELETE_DATA=1 -> borra también los datos sin preguntar (solo para pruebas).
. (Join-Path $PSScriptRoot 'lib.ps1')

$Here    = Get-FullPath (Join-Path $PSScriptRoot '..\..')
$Install = Get-FullPath (Get-WpInstallDir)
$Paths   = Get-WpPaths
$DataDir = Get-WpDataDir
# Esta ventana no debe estar "dentro" de la carpeta que vamos a borrar (Windows no deja borrar una carpeta en uso)
try { Set-Location -LiteralPath $env:TEMP } catch {}

try {
    Write-Banner 'Desinstalador para Windows'
    Write-Host '  Voy a quitar WillyPost de este ordenador:' -ForegroundColor White
    Write-Host '    - el icono del Escritorio y del menú Inicio' -ForegroundColor Gray
    Write-Host '    - el arranque automático' -ForegroundColor Gray
    Write-Host "    - la aplicación (en $Install)" -ForegroundColor Gray
    Write-Host '  Tus publicaciones y cuentas conectadas NO se tocan, salvo que lo pidas después.' -ForegroundColor Gray
    Write-Host ''
    if ($env:WILLYPOST_YES -ne '1' -and -not $global:DryRun) {
        $a = Read-Host '  ¿Quieres desinstalar WillyPost? (escribe S y pulsa Intro para continuar)'
        if ($a.Trim() -notmatch '^(s|si|sí|y|yes)$') { Write-Host '  Vale, no he cambiado nada.' -ForegroundColor Green; exit 0 }
    }

    Write-Step 1 4 'Parando WillyPost...'
    Invoke-Action 'Parar el servidor de WillyPost' { if (Stop-WillyPostServer $Install) { Write-Ok 'Detenido.' } else { Write-Info 'No estaba en marcha.' } }

    Write-Step 2 4 'Quitando accesos directos y arranque automático...'
    foreach ($f in @($Paths.Desktop, $Paths.Startup)) {
        Invoke-Action "Borrar $f" { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
    }
    Invoke-Action "Borrar carpeta del menú Inicio: $($Paths.MenuDir)" { if (Test-Path -LiteralPath $Paths.MenuDir) { Remove-Item -LiteralPath $Paths.MenuDir -Recurse -Force } }
    Invoke-Action "Quitar el registro en 'Aplicaciones instaladas': $($Paths.UninstKey)" { if (Test-Path -LiteralPath $Paths.UninstKey) { Remove-Item -LiteralPath $Paths.UninstKey -Recurse -Force } }
    if (-not $global:DryRun) { Write-Ok 'Accesos directos y arranque automático eliminados.' }

    Write-Step 3 4 'Tus datos'
    Write-Info "Están en: $DataDir"
    Write-Info 'Ahí viven tus publicaciones, tus cuentas conectadas y tus claves de desarrollador.'
    if (Test-Path -LiteralPath $DataDir) {
        $ans = 'N'
        if ($env:WILLYPOST_DELETE_DATA -eq '1') { $ans = 'BORRAR' }
        elseif ($env:WILLYPOST_YES -ne '1' -and -not $global:DryRun) {
            Write-Host ''
            Write-Host '  ¿Quieres BORRAR también tus datos? No se puede deshacer.' -ForegroundColor Yellow
            Write-Host '  Si vas a reinstalar WillyPost más adelante, es mejor conservarlos.' -ForegroundColor Yellow
            $ans = (Read-Host '  Escribe BORRAR para eliminarlos, o pulsa Intro para conservarlos').Trim()
        }
        if ($ans -ceq 'BORRAR') {
            Invoke-Action "Borrar la carpeta de datos $DataDir" { Remove-Item -LiteralPath $DataDir -Recurse -Force; Write-Ok 'Datos eliminados.' }
        } else {
            Write-Ok 'Datos conservados. Si algún día quieres borrarlos, elimina esa carpeta.'
        }
    } else {
        Write-Info 'No hay datos guardados.'
    }

    Write-Step 4 4 'Quitando la aplicación...'
    # Seguridad: solo se borra una carpeta que termine en \WillyPost\app y contenga package.json
    $isInstalledCopy = ($Install -match '\\WillyPost\\app$') -and (Test-Path -LiteralPath (Join-Path $Install 'package.json'))
    if ($isInstalledCopy -and (Test-Path -LiteralPath $Install)) {
        Invoke-Action "Borrar la carpeta de la aplicación $Install (en segundo plano, reintentando hasta que esta ventana se cierre)" {
            $q = $Install.Replace("'", "''")
            $cmd = "for(`$i=0;`$i -lt 300;`$i++){ if(Test-Path -LiteralPath '$q'){ Remove-Item -LiteralPath '$q' -Recurse -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 } else { break } }; " +
                   "`$p = Split-Path -LiteralPath '$q'; if((Test-Path -LiteralPath `$p) -and -not (Get-ChildItem -LiteralPath `$p -Force)){ Remove-Item -LiteralPath `$p -Force -ErrorAction SilentlyContinue }"
            $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
            Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $enc) -WorkingDirectory $env:TEMP -WindowStyle Hidden
            Write-Ok 'La aplicación se está borrando (en unos segundos desaparece la carpeta).'
        }
    } else {
        Write-Info 'No he encontrado una instalación de WillyPost que borrar.'
    }
    if ($Here -ine $Install) {
        Write-Info "La carpeta que descomprimiste ($Here) puedes borrarla tú cuando quieras."
    }

    Write-Host ''
    Write-Host '  ==================================================' -ForegroundColor Green
    Write-Host '   WillyPost se ha desinstalado. ¡Gracias por probarlo!' -ForegroundColor Green
    Write-Host '   Recuerda quitar también el permiso en cada red social si lo conectaste:' -ForegroundColor Gray
    Write-Host '   https://nuriaatlantis.github.io/willypost/borrar-datos.html' -ForegroundColor Gray
    Write-Host '  ==================================================' -ForegroundColor Green
    exit 0
}
catch {
    Write-Fail ('Algo no ha ido bien: ' + $_.Exception.Message)
    Write-Host '      Cierra WillyPost y vuelve a intentarlo. Si sigue fallando, escribe a nuria.olive@gmail.com y pega este mensaje.' -ForegroundColor Yellow
    exit 1
}
