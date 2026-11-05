# WillyPost - corazón de "Instalar-WillyPost.exe" (lo lanza instalar-willypost.cmd).
# 1. Descarga la ÚLTIMA versión de WillyPost (el ZIP de la rama main de GitHub) a una carpeta temporal.
# 2. La descomprime.
# 3. Ejecuta el instalador de siempre (scripts\windows\instalar.ps1) desde ahí, en esta misma ventana.
# Así el .exe nunca se queda viejo: siempre instala lo último, y para actualizar basta con volver a abrirlo.
# Este archivo se guarda en UTF-8 con BOM (para que PowerShell 5.1 lea bien los acentos).
# Variables opcionales (para pruebas):
#   WILLYPOST_ZIP_URL  otra dirección del ZIP (https://..., file:///... o una ruta local a un .zip)
#   DRYRUN=1           el instalador solo muestra lo que haría (la descarga sí se hace)
#   (y todas las que admite instalar.ps1: WILLYPOST_APP_DIR, WILLYPOST_DATA, WILLYPOST_PORT...)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$ZipUrl  = if ($env:WILLYPOST_ZIP_URL) { $env:WILLYPOST_ZIP_URL } else { 'https://github.com/NuriaAtlantis/willypost/archive/refs/heads/main.zip' }
$TempDir = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }
$WorkRoot = Join-Path $TempDir 'WillyPost-instalador'
$Work    = Join-Path $WorkRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
$Zip     = Join-Path $Work 'willypost.zip'
$Dest    = Join-Path $Work 'archivos'
$LogFile = Join-Path $TempDir 'WillyPost-instalador.log'
$script:Paso = 'inicio'

function Write-Log([string]$Text) {
    try { Add-Content -LiteralPath $LogFile -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Text) -Encoding UTF8 } catch {}
}
function Write-Ok([string]$Text)   { Write-Host "      OK  $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "      $Text" -ForegroundColor Gray }

function Get-Zip([string]$Url, [string]$Path) {
    # Ruta local o file:/// (solo para pruebas): se copia tal cual.
    if ($Url -match '^file:' -or $Url -notmatch '^[a-z]+://') {
        $local = if ($Url -match '^file:') { ([Uri]$Url).LocalPath } else { $Url }
        Copy-Item -LiteralPath $local -Destination $Path -Force
        return
    }
    for ($try = 1; $try -le 3; $try++) {
        try {
            $req = [Net.HttpWebRequest]::Create($Url)
            $req.UserAgent = 'WillyPost-Installer'
            $req.Timeout = 30000; $req.ReadWriteTimeout = 60000
            $req.Proxy = [Net.WebRequest]::GetSystemWebProxy()
            $req.Proxy.Credentials = [Net.CredentialCache]::DefaultCredentials
            $resp = $req.GetResponse()
            try {
                $in = $resp.GetResponseStream()
                $out = [IO.File]::Create($Path)
                try {
                    $buf = New-Object byte[] 65536
                    $total = 0; $shown = -1
                    while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
                        $out.Write($buf, 0, $n); $total += $n
                        $mb = [math]::Floor($total / 1MB)
                        if ($mb -ne $shown) { $shown = $mb; Write-Host -NoNewline ("`r      Descargando... {0} MB " -f $mb) -ForegroundColor Gray }
                    }
                    Write-Host ''
                } finally { $out.Dispose(); $in.Dispose() }
            } finally { $resp.Close() }
            return
        } catch {
            Write-Host ''
            $err = Get-InnerError $_.Exception
            # 404 = la dirección no existe: reintentar no sirve de nada
            $notFound = ($err -is [Net.WebException]) -and $err.Response -and ([int]$err.Response.StatusCode -eq 404)
            if ($try -ge 3 -or $notFound) { throw $err }
            Write-Host "      ! La descarga ha fallado ($($err.Message)). Reintento ($($try + 1)/3)..." -ForegroundColor Yellow
            Start-Sleep -Seconds (3 * $try)
        }
    }
}

function Get-InnerError($Ex) {
    # PowerShell envuelve los errores de .NET ("Excepción al llamar a ..."): nos quedamos con el original
    while ($Ex.InnerException) { $Ex = $Ex.InnerException }
    return $Ex
}

try {
    Write-Host ''
    Write-Host '  ==================================================' -ForegroundColor Cyan
    Write-Host '     WillyPost  -  by Willy SEO Academy' -ForegroundColor White
    Write-Host '     Instalador para Windows' -ForegroundColor Gray
    Write-Host '  ==================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Descargando la última versión de WillyPost...' -ForegroundColor Cyan
    Write-Info "Desde: $ZipUrl"
    Write-Log "Inicio. ZIP: $ZipUrl  Carpeta: $Work  DRYRUN=$($env:DRYRUN)"

    # Limpiar restos de ejecuciones anteriores (si algo está bloqueado, no pasa nada: se usa una carpeta nueva)
    if (Test-Path -LiteralPath $WorkRoot) {
        Get-ChildItem -LiteralPath $WorkRoot -Force -ErrorAction SilentlyContinue |
            ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch {} }
    }
    New-Item -ItemType Directory -Force -Path $Work | Out-Null

    $script:Paso = 'descarga'
    Get-Zip $ZipUrl $Zip
    $size = (Get-Item -LiteralPath $Zip).Length
    $fs = [IO.File]::OpenRead($Zip)
    try { $b1 = $fs.ReadByte(); $b2 = $fs.ReadByte() } finally { $fs.Dispose() }
    if ($size -lt 100KB -or $b1 -ne 0x50 -or $b2 -ne 0x4B) {
        throw 'Lo descargado no es el ZIP de WillyPost (¿una red con página de acceso, como la de un hotel o una empresa?).'
    }
    Write-Ok ("Descargado ({0:N1} MB)." -f ($size / 1MB))

    $script:Paso = 'descomprimir'
    Write-Info 'Descomprimiendo...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Dest)
    $root = Get-ChildItem -LiteralPath $Dest -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'scripts\windows\instalar.ps1') } |
        Select-Object -First 1
    if (-not $root -and (Test-Path -LiteralPath (Join-Path $Dest 'scripts\windows\instalar.ps1'))) { $root = Get-Item -LiteralPath $Dest }
    if (-not $root) { throw 'El ZIP descargado no contiene el instalador de WillyPost (scripts\windows\instalar.ps1).' }
    Write-Ok 'Listo para instalar.'
    Write-Log "Descomprimido en $($root.FullName)"

    # Lanzar el instalador de siempre, en esta misma ventana
    $script:Paso = 'instalar'
    $installer = Join-Path $root.FullName 'scripts\windows\instalar.ps1'
    $psExe = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $psExe)) { $psExe = 'powershell.exe' }
    $env:WILLYPOST_DESDE_EXE = '1'
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $installer
    $rc = $LASTEXITCODE
    Write-Log "instalar.ps1 ha terminado con código $rc"

    if ($rc -eq 0) {
        # La aplicación ya está copiada en su carpeta: lo descargado ya no hace falta.
        Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit $rc
}
catch {
    $msg = (Get-InnerError $_.Exception).Message
    Write-Log "ERROR ($($script:Paso)): $msg"
    Write-Host ''
    if ($script:Paso -eq 'descarga') {
        Write-Host "      X  No he podido descargar WillyPost: $msg" -ForegroundColor Red
        Write-Host '      Comprueba tu conexión a internet y vuelve a abrir "Instalar-WillyPost.exe".' -ForegroundColor Yellow
        Write-Host '      Si estás en una red de empresa o colegio, prueba con otra red (por ejemplo, el móvil como punto de acceso).' -ForegroundColor Yellow
    } else {
        Write-Host "      X  Algo no ha ido bien: $msg" -ForegroundColor Red
        Write-Host '      Vuelve a abrir "Instalar-WillyPost.exe". Si tienes antivirus, espera un minuto antes de repetir.' -ForegroundColor Yellow
    }
    Write-Host '      Plan B: descarga el ZIP desde https://willypost.com, descomprímelo y haz doble clic en "Instalar WillyPost".' -ForegroundColor Gray
    Write-Host "      Si sigue fallando, escribe a nuria.olive@gmail.com y adjunta el registro: $LogFile" -ForegroundColor Gray
    exit 1
}
