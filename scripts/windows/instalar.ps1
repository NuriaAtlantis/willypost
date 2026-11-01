# WillyPost - instalador para Windows (lo lanza "Instalar WillyPost.bat").
# - No necesita permisos de administrador.
# - Se puede ejecutar todas las veces que quieras: sirve para instalar, reparar y actualizar.
# - Variables opcionales: DRYRUN=1 (solo muestra lo que haria), WILLYPOST_APP_DIR (carpeta de instalacion),
#   WILLYPOST_FORCE=1 (reinstala las dependencias aunque parezcan correctas), WILLYPOST_NO_OPEN=1.
param([switch]$NoAbrir)

. (Join-Path $PSScriptRoot 'lib.ps1')

$Total   = 6
$Source  = Get-FullPath (Join-Path $PSScriptRoot '..\..')            # carpeta descomprimida
$Install = Get-FullPath (Get-WpInstallDir)                           # %LOCALAPPDATA%\WillyPost\app
$Paths   = Get-WpPaths
$DataDir = Get-WpDataDir
$Version = Get-AppVersion $Source
$NodeDir = Join-Path $Install 'runtime\node'
$NodeExe = $null
$Force   = ($env:WILLYPOST_FORCE -eq '1')
$script:Hint = ''     # consejo que se muestra si el paso actual falla

function Stop-WithError([string]$Msg, [string]$Hint = '') {
    Write-Host ''
    Write-Fail $Msg
    if ($Hint) { Write-Host "      $Hint" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '      Si no consigues arreglarlo, escribe a hola@willyseo.net contando en qué paso se ha parado.' -ForegroundColor Gray
    exit 1
}

try {
    Write-Banner "Instalador para Windows  (versión $Version)"

    # ------------------------------------------------------------------ 1. Comprobaciones
    Write-Step 1 $Total 'Comprobando tu ordenador...'
    $script:Hint = 'Descomprime TODA la carpeta del ZIP (clic derecho, Extraer todo) y vuelve a hacer doble clic en "Instalar WillyPost".'
    if (-not (Test-Path -LiteralPath (Join-Path $Source 'server\index.js')) -or -not (Test-Path -LiteralPath (Join-Path $Source 'package.json'))) {
        Stop-WithError 'No encuentro los archivos de WillyPost junto a este instalador.' $script:Hint
    }
    if ($Source -match '\.zip(\\|$)' -or $Source -match '\\Temp\\Temp\d*_') {
        Stop-WithError 'Estás abriendo el instalador desde DENTRO del ZIP.' 'Cierra esta ventana, haz clic derecho sobre el ZIP > "Extraer todo..." y abre la carpeta nueva que aparece.'
    }
    if ([Environment]::OSVersion.Version.Major -lt 10) {
        Stop-WithError 'WillyPost necesita Windows 10 u 11.' 'Tu versión de Windows es demasiado antigua.'
    }
    Write-Ok "Windows 10/11 ($(Get-OsArch))"
    if ($Source -match '\\OneDrive') {
        Write-Warn2 'Esta carpeta está dentro de OneDrive. No pasa nada: WillyPost se instala aparte, fuera de OneDrive.'
    }
    try {
        $drive = Get-PSDrive -Name ($Install.Substring(0, 1)) -ErrorAction Stop
        if ($drive.Free -lt 700MB) { Stop-WithError 'No hay espacio suficiente en el disco (hacen falta unos 700 MB libres).' 'Libera espacio y vuelve a intentarlo.' }
        Write-Ok ("Espacio libre: {0:N1} GB" -f ($drive.Free / 1GB))
    } catch {
        # (Stop-WithError sale con "exit", no con excepcion; aqui solo cae un fallo de Get-PSDrive, p.ej. ruta de red)
    }
    Write-Info "WillyPost se instalará en: $Install"
    Write-Info "Tus datos (publicaciones, cuentas...) viven aparte, en: $DataDir"
    Invoke-Action 'Desbloquear los archivos descargados (quitar la marca de "descargado de internet")' {
        Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\(node_modules|runtime|\.git)\\' } |
            ForEach-Object { try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {} }
    }

    # ------------------------------------------------------------------ 2. Copiar la aplicacion
    Write-Step 2 $Total 'Copiando WillyPost a su carpeta...'
    $script:Hint = 'Cierra WillyPost y cualquier ventana que tengas abierta dentro de la carpeta de instalación. Si tienes antivirus, es posible que esté revisando los archivos: espera un minuto y repite.'
    $wasRunning = Test-WillyPostHealth
    if ($wasRunning) { Write-Info 'WillyPost estaba abierto: lo paro un momento para actualizarlo.' }
    Invoke-Action 'Parar WillyPost si está en marcha' { [void](Stop-WillyPostServer $Install) }
    if (-not $global:DryRun) {
        if (Test-WillyPostHealth) {
            Stop-WithError "WillyPost sigue abierto y no he conseguido pararlo (¿lo tiene abierto otro usuario de este ordenador?)." 'Reinicia el ordenador y vuelve a ejecutar el instalador.'
        }
        if (-not (Test-PortFree $global:WpPort)) {
            Stop-WithError "Otro programa está usando el puerto $($global:WpPort), que WillyPost necesita." 'Reinicia el ordenador (así se cierra ese programa) y vuelve a ejecutar el instalador.'
        }
    }
    if ($Source -ieq $Install) {
        Write-Ok 'Ya estás ejecutando el instalador desde la carpeta de instalación.'
    } else {
        Invoke-Action "Copiar $Source  ->  $Install  (se conservan runtime y node_modules)" {
            New-Item -ItemType Directory -Force -Path $Install | Out-Null
            & robocopy.exe $Source $Install /MIR /XD runtime node_modules .git /NFL /NDL /NJH /NJS /NP /R:3 /W:2 | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "No he podido copiar los archivos (robocopy código $LASTEXITCODE)." }
            $global:LASTEXITCODE = 0
            # Por si la marca de "descargado de internet" viajara con la copia
            Get-ChildItem -LiteralPath $Install -Recurse -File -Force -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -notmatch '\\(node_modules|runtime)\\' } |
                ForEach-Object { try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {} }
        }
        if (-not $global:DryRun) { Write-Ok 'Archivos copiados.' }
    }

    # ------------------------------------------------------------------ 3. Node.js
    Write-Step 3 $Total 'Preparando Node.js (el motor de WillyPost)...'
    $script:Hint = 'Parece un problema de conexión con nodejs.org. Comprueba tu internet y repite. Si estás en una red de empresa o colegio, prueba con otra red (por ejemplo, el móvil como punto de acceso).'
    $portable = Join-Path $NodeDir 'node.exe'
    if (Test-NodeExe $portable) {
        $NodeExe = $portable
        Write-Ok "Node portable ya instalado ($( & $portable -p 'process.versions.node' ))."
    } else {
        $sys = Find-SystemNode
        if ($sys) {
            $NodeExe = $sys
            Write-Ok "Usando el Node que ya tienes instalado ($( & $sys -p 'process.versions.node' ))."
        } else {
            Write-Info 'No tienes Node 22.13 o superior. Voy a descargar Node 24 LTS (portable, sin instalar nada en Windows).'
            $rel = Get-NodeRelease
            Write-Info "Versión: $($rel.Version) ($($rel.Arch))  -  $($rel.Url)"
            $tmpRoot = Join-Path $env:TEMP 'wp-node'
            $zip = Join-Path $tmpRoot $rel.FileName
            Invoke-Action "Descargar $($rel.Url) (unos 35 MB) y comprobar su huella SHA-256 con $($rel.ShaUrl)" {
                if (Test-Path -LiteralPath $tmpRoot) { Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue }
                New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
                Save-Download $rel.Url $zip
                $sums = (Invoke-WebRequest -Uri $rel.ShaUrl -UseBasicParsing -TimeoutSec 40).Content
                if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
                $m = [regex]::Match($sums, '(?m)^([0-9a-fA-F]{64})\s+' + [regex]::Escape($rel.FileName) + '\s*$')
                if (-not $m.Success) { throw 'No encuentro la huella de verificación de Node en nodejs.org.' }
                $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
                if ($got -ne $m.Groups[1].Value.ToUpper()) { throw 'La descarga de Node está corrupta (la huella no coincide). Vuelve a intentarlo.' }
                Write-Ok 'Descarga verificada.'
            }
            Invoke-Action "Descomprimir Node en $NodeDir" {
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                # Se descomprime dentro de la carpeta de instalación (mismo disco) para poder moverlo de golpe
                $ex = Join-Path $Install 'runtime\_node-tmp'
                if (Test-Path -LiteralPath $ex) { Remove-Item -LiteralPath $ex -Recurse -Force -ErrorAction SilentlyContinue }
                New-Item -ItemType Directory -Force -Path $ex | Out-Null
                [IO.Compression.ZipFile]::ExtractToDirectory($zip, $ex)
                $inner = Get-ChildItem -LiteralPath $ex -Directory | Select-Object -First 1
                if (Test-Path -LiteralPath $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
                for ($i = 1; $i -le 6; $i++) {
                    # (el antivirus a veces bloquea la carpeta unos segundos nada mas descomprimir)
                    try { Move-Item -LiteralPath $inner.FullName -Destination $NodeDir -ErrorAction Stop; break }
                    catch { if ($i -ge 6) { throw }; Start-Sleep -Seconds 2 }
                }
                Remove-Item -LiteralPath $ex -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
                if (-not (Test-NodeExe $portable)) { throw 'Node se ha descomprimido pero no arranca (¿el antivirus lo ha bloqueado?).' }
                Write-Ok "Node instalado en $NodeDir"
            }
            $NodeExe = $portable
        }
    }

    # ------------------------------------------------------------------ 4. Dependencias (npm)
    Write-Step 4 $Total 'Instalando las piezas de WillyPost (puede tardar un par de minutos)...'
    $script:Hint = 'Comprueba tu conexión a internet y repite. Si usas antivirus, es posible que esté bloqueando la instalación: prueba a repetirlo pasado un minuto.'
    $lockFile = Join-Path $Install 'package-lock.json'
    $stampFile = Join-Path $Install 'runtime\npm-stamp.txt'
    $hashSrc = if (Test-Path -LiteralPath $lockFile) { $lockFile } else { Join-Path $Install 'package.json' }
    $needNpm = $true
    if (-not $global:DryRun -and -not $Force -and (Test-Path -LiteralPath $hashSrc) -and (Test-Path -LiteralPath $stampFile) -and (Test-Path -LiteralPath (Join-Path $Install 'node_modules'))) {
        $cur = (Get-FileHash -LiteralPath $hashSrc -Algorithm SHA256).Hash
        if ((Get-Content -LiteralPath $stampFile -Raw).Trim() -eq $cur) {
            Push-Location -LiteralPath $Install
            try {
                & $NodeExe --input-type=module -e "await import('express'); await import('sharp');" 2>$null
                if ($LASTEXITCODE -eq 0) { $needNpm = $false }
            } catch {} finally { Pop-Location }
        }
    }
    if (-not $needNpm) {
        Write-Ok 'Las piezas ya estaban instaladas y funcionan.'
    } else {
        $npmCmd = Join-Path (Split-Path $NodeExe) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npmCmd)) { $c = Get-Command npm.cmd -ErrorAction SilentlyContinue; if ($c) { $npmCmd = $c.Source } }
        $cmdText = if ((Test-Path -LiteralPath $lockFile) -or ($global:DryRun -and (Test-Path -LiteralPath (Join-Path $Source 'package-lock.json')))) { 'npm ci --omit=dev  (si falla: npm install --omit=dev)' } else { 'npm install --omit=dev' }
        Invoke-Action "En $Install ejecutar: $cmdText" {
            $env:PATH = (Split-Path $NodeExe) + ';' + $env:PATH
            $env:npm_config_update_notifier = 'false'
            Write-Info 'Descargando e instalando. No cierres esta ventana.'
            Push-Location -LiteralPath $Install
            try {
                $ok = $false
                if (Test-Path -LiteralPath $lockFile) {
                    & $npmCmd ci --omit=dev --include=optional --no-audit --no-fund --loglevel=error
                    $ok = ($LASTEXITCODE -eq 0)
                    if (-not $ok) { Write-Warn2 'npm ci no ha funcionado; pruebo con npm install...' }
                }
                if (-not $ok) {
                    & $npmCmd install --omit=dev --include=optional --no-audit --no-fund --loglevel=error
                    $ok = ($LASTEXITCODE -eq 0)
                }
                if (-not $ok) { throw 'npm no ha podido instalar las piezas (casi siempre es la conexión a internet).' }
                # Comprobacion final: que de verdad arrancan (sharp trae programas nativos que dependen del ordenador)
                & $NodeExe --input-type=module -e "await import('express'); await import('sharp');" 2>$null
                if ($LASTEXITCODE -ne 0) { throw 'Las piezas se han descargado pero no arrancan en este ordenador (¿lo ha bloqueado el antivirus?).' }
                New-Item -ItemType Directory -Force -Path (Split-Path $stampFile) | Out-Null
                Set-Content -LiteralPath $stampFile -Value (Get-FileHash -LiteralPath $hashSrc -Algorithm SHA256).Hash -Encoding ASCII
            } finally { Pop-Location }
            Write-Ok 'Piezas instaladas.'
        }
    }
    Invoke-Action 'Guardar en runtime\node-path.txt el Node que se usara para arrancar' {
        New-Item -ItemType Directory -Force -Path (Join-Path $Install 'runtime') | Out-Null
        Set-Content -LiteralPath (Join-Path $Install 'runtime\node-path.txt') -Value $NodeExe -Encoding UTF8
    }

    # ------------------------------------------------------------------ 5. Accesos directos
    Write-Step 5 $Total 'Creando los accesos directos...'
    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $vbs     = Join-Path $Install 'scripts\windows\iniciar-oculto.vbs'
    $icon    = Join-Path $Install 'scripts\willypost.ico'
    $argsOpen = "//nologo `"$vbs`" abrir"
    $argsAuto = "//nologo `"$vbs`""
    $shortcutProblems = 0
    # Un acceso directo que falle NO debe tirar abajo la instalacion: se avisa y se sigue.
    function Add-Shortcut([string]$What, [scriptblock]$Script) {
        try { & $Script } catch { $script:shortcutProblems++; Write-Warn2 "No he podido crear $What ($($_.Exception.Message))." }
    }
    if ($env:WILLYPOST_SKIP_SHORTCUTS -eq '1') { Write-Warn2 'WILLYPOST_SKIP_SHORTCUTS=1: no se crean accesos directos (solo para pruebas).' } else {
    Invoke-Action "Acceso directo 'WillyPost' en el Escritorio: $($Paths.Desktop)" {
        Add-Shortcut 'el icono del Escritorio' {
            New-WpShortcut -Path $Paths.Desktop -Target $wscript -Arguments $argsOpen -WorkDir $Install -Icon $icon -Description 'Abre WillyPost'
        }
    }
    Invoke-Action "Menú Inicio: $($Paths.MenuDir)  (WillyPost, Detener WillyPost y Desinstalar WillyPost)" {
        Add-Shortcut 'los iconos del menú Inicio' {
            New-Item -ItemType Directory -Force -Path $Paths.MenuDir | Out-Null
            New-WpShortcut -Path $Paths.MenuOpen -Target $wscript -Arguments $argsOpen -WorkDir $Install -Icon $icon -Description 'Abre WillyPost'
            New-WpShortcut -Path $Paths.MenuStop -Target (Join-Path $Install 'scripts\windows\detener.bat') -WorkDir $Install -Icon $icon -Description 'Para WillyPost (se vuelve a encender con el icono WillyPost)'
            New-WpShortcut -Path $Paths.MenuUninst -Target (Join-Path $Install 'Desinstalar WillyPost.bat') -WorkDir $Install -Icon $icon -Description 'Quita WillyPost de este ordenador'
        }
    }
    Invoke-Action "Arranque automático al iniciar sesión (carpeta Inicio): $($Paths.Startup)" {
        Add-Shortcut 'el arranque automático' {
            New-WpShortcut -Path $Paths.Startup -Target $wscript -Arguments $argsAuto -WorkDir $Install -Icon $icon -Description 'Arranca WillyPost en segundo plano' -WindowStyle 7
        }
    }
    Invoke-Action "Registrar WillyPost en 'Aplicaciones instaladas' de Windows (solo tu usuario): $($Paths.UninstKey)" {
        Add-Shortcut 'la entrada en "Aplicaciones instaladas"' {
            New-Item -Path $Paths.UninstKey -Force | Out-Null
            $k = $Paths.UninstKey
            Set-ItemProperty -Path $k -Name DisplayName -Value 'WillyPost'
            Set-ItemProperty -Path $k -Name DisplayVersion -Value $Version
            Set-ItemProperty -Path $k -Name Publisher -Value 'Willy SEO Academy'
            Set-ItemProperty -Path $k -Name DisplayIcon -Value $icon
            Set-ItemProperty -Path $k -Name InstallLocation -Value $Install
            Set-ItemProperty -Path $k -Name UninstallString -Value ('"' + (Join-Path $Install 'Desinstalar WillyPost.bat') + '"')
            Set-ItemProperty -Path $k -Name NoModify -Value 1 -Type DWord
            Set-ItemProperty -Path $k -Name NoRepair -Value 1 -Type DWord
        }
    }
    if (-not $global:DryRun) {
        if ($script:shortcutProblems -eq 0) {
            Write-Ok 'Icono "WillyPost" en el Escritorio y en el menú Inicio.'
            Write-Ok 'WillyPost arrancará solo cuando inicies sesión en Windows (en segundo plano, sin ventanas).'
        } else {
            Write-Warn2 'Algún acceso directo no se ha creado. WillyPost funciona igual: para abrirlo escribe http://localhost:4747 en tu navegador.'
        }
    }
    }

    # ------------------------------------------------------------------ 6. Arrancar
    Write-Step 6 $Total 'Arrancando WillyPost...'
    $script:Hint = ''
    Invoke-Action "Arrancar el servidor oculto: wscript iniciar-oculto.vbs  ->  $NodeExe --disable-warning=ExperimentalWarning server\index.js" {
        Start-Process -FilePath $wscript -ArgumentList $argsAuto -WorkingDirectory $Install -WindowStyle Hidden
    }
    if (-not $global:DryRun) {
        if (Wait-WillyPost 60) {
            Write-Ok "WillyPost está funcionando en $($global:WpUrl)"
            $noOpen = ($NoAbrir -or $env:WILLYPOST_NO_OPEN -eq '1')
            if (-not $noOpen) {
                try { Start-Process $global:WpUrl } catch { Write-Warn2 "No he podido abrir el navegador. Escribe $($global:WpUrl) en tu navegador." }
            }
        } else {
            $log = Join-Path $DataDir 'logs\servidor.log'
            Write-Host ''
            Show-LogTail $log
            Stop-WithError 'WillyPost no ha llegado a arrancar.' "Vuelve a ejecutar este instalador. Si sigue igual, el registro completo está en: $log"
        }
    } else {
        Write-Dry "Esperar a que responda $($global:WpUrl)/api/health y abrir el navegador en $($global:WpUrl)"
    }

    Write-Host ''
    if ($global:DryRun) {
        Write-Host '  Fin de la prueba (DRYRUN): no se ha cambiado nada.' -ForegroundColor Magenta
        exit 0
    }
    Write-Host '  ==================================================' -ForegroundColor Green
    Write-Host '   LISTO. WillyPost ya está instalado.' -ForegroundColor Green
    Write-Host "   - Se ha abierto en tu navegador: $($global:WpUrl)" -ForegroundColor Gray
    Write-Host '   - La próxima vez, usa el icono "WillyPost" del Escritorio.' -ForegroundColor Gray
    Write-Host '   - Para actualizar: descarga el ZIP nuevo y vuelve a ejecutar "Instalar WillyPost".' -ForegroundColor Gray
    Write-Host '   - Puedes borrar la carpeta que descomprimiste: ya no hace falta.' -ForegroundColor Gray
    Write-Host '  ==================================================' -ForegroundColor Green
    Write-Host ''
    exit 0
}
catch {
    Write-Host ''
    Write-Fail ("Algo no ha ido bien: " + $_.Exception.Message)
    if ($script:Hint) { Write-Host "      $($script:Hint)" -ForegroundColor Yellow }
    Write-Host '      Vuelve a hacer doble clic en "Instalar WillyPost": repite solo lo que faltaba.' -ForegroundColor Yellow
    Write-Host '      Si sigue fallando, escribe a hola@willyseo.net y pega este mensaje.' -ForegroundColor Gray
    exit 1
}
