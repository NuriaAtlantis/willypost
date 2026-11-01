# WillyPost - funciones comunes de los scripts de Windows.
# Este archivo se guarda en UTF-8 con BOM (para que PowerShell 5.1 lea bien los acentos).
# Interruptor de pruebas: define DRYRUN=1 en el entorno y los scripts solo IMPRIMEN lo que harian.

$ErrorActionPreference = 'Stop'
# Windows 10 antiguo / PowerShell 5.1 a veces no activa TLS 1.2 por defecto (nodejs.org lo exige)
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$global:DryRun   = ($env:DRYRUN -eq '1' -or $env:DRYRUN -eq 'true')
$global:WpPort   = if ($env:WILLYPOST_PORT) { [int]$env:WILLYPOST_PORT } else { 4747 }   # igual que server/config.js
$global:WpUrl    = "http://localhost:$($global:WpPort)"
$global:MinNode  = [version]'22.13.0'
$global:NodeMajor = 24                      # Node 24 LTS
$global:FallbackNodeVersion = 'v24.15.0'    # solo si nodejs.org/dist/index.json no responde

# ---------- Mensajes ----------
function Write-Banner {
    param([string]$Subtitle = '')
    Write-Host ''
    Write-Host '  ==================================================' -ForegroundColor Cyan
    Write-Host '     WillyPost  -  by Willy SEO Academy' -ForegroundColor White
    if ($Subtitle) { Write-Host "     $Subtitle" -ForegroundColor Gray }
    Write-Host '  ==================================================' -ForegroundColor Cyan
    if ($global:DryRun) {
        Write-Host '  MODO PRUEBA (DRYRUN): no se cambia nada, solo se muestra lo que se haria.' -ForegroundColor Magenta
    }
    Write-Host ''
}
function Write-Step([int]$N, [int]$Total, [string]$Text) {
    Write-Host ''
    Write-Host ("  [{0}/{1}] {2}" -f $N, $Total, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text)   { Write-Host "      OK  $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "      $Text" -ForegroundColor Gray }
function Write-Warn2([string]$Text){ Write-Host "      ! $Text" -ForegroundColor Yellow }
function Write-Dry([string]$Text)  { Write-Host "      [DRYRUN] $Text" -ForegroundColor Magenta }
function Write-Fail([string]$Text) { Write-Host "      X  $Text" -ForegroundColor Red }

# Ejecuta (o, en DRYRUN, solo describe) una accion que cambia cosas.
function Invoke-Action {
    param([string]$Text, [scriptblock]$Script)
    if ($global:DryRun) { Write-Dry $Text; return }
    & $Script
}

# ---------- Rutas ----------
function Get-FullPath([string]$Path) {
    # Ruta absoluta y limpia SIN interpretar [corchetes] ni comodines (Resolve-Path los interpreta y falla).
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

# ---------- Sistema ----------
function Get-OsArch {
    try { return [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch {}
    $a = $env:PROCESSOR_ARCHITEW6432
    if (-not $a) { $a = $env:PROCESSOR_ARCHITECTURE }
    if ($a -match 'ARM64') { return 'Arm64' }
    return 'X64'
}

function Get-AppVersion([string]$Root) {
    try { return (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { return '1.0.0' }
}

# ---------- Node.js ----------
function Test-NodeExe([string]$Exe) {
    # True si ese node existe y es >= 22.13
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $false }
    try {
        $v = (& $Exe -p 'process.versions.node' 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not $v) { return $false }
        return ([version]($v.Trim()) -ge $global:MinNode)
    } catch { return $false }
}

function Find-SystemNode {
    if ($env:WILLYPOST_IGNORE_SYSTEM_NODE -eq '1') { return $null }   # solo para pruebas
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    # Solo lo usamos si trae su npm al lado (si no, mejor descargar el nuestro, que siempre esta completo)
    if ($cmd -and (Test-NodeExe $cmd.Source) -and (Test-Path -LiteralPath (Join-Path (Split-Path $cmd.Source) 'npm.cmd'))) { return $cmd.Source }
    return $null
}

function Get-NodeRelease {
    # Resuelve la última versión de Node 24 LTS para esta máquina (zip portable de nodejs.org).
    $arch = if ((Get-OsArch) -eq 'Arm64') { 'arm64' } else { 'x64' }
    $version = $null
    try {
        $idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 40
        $m = $idx | Where-Object { $_.version -like "v$($global:NodeMajor).*" -and $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
        if ($m) { $version = $m.version }
    } catch { Write-Warn2 "No he podido leer la lista de versiones de nodejs.org ($($_.Exception.Message)). Uso $($global:FallbackNodeVersion)." }
    if (-not $version) { $version = $global:FallbackNodeVersion }
    $file = "node-$version-win-$arch.zip"
    return [pscustomobject]@{
        Version = $version; Arch = $arch; FileName = $file
        Url     = "https://nodejs.org/dist/$version/$file"
        ShaUrl  = "https://nodejs.org/dist/$version/SHASUMS256.txt"
    }
}

function Save-Download([string]$Url, [string]$Dest) {
    for ($try = 1; $try -le 3; $try++) {
        try {
            $req = [Net.HttpWebRequest]::Create($Url)
            $req.UserAgent = 'WillyPost-Installer'
            $req.Timeout = 30000; $req.ReadWriteTimeout = 60000
            $req.Proxy = [Net.WebRequest]::GetSystemWebProxy()
            $req.Proxy.Credentials = [Net.CredentialCache]::DefaultCredentials
            $resp = $req.GetResponse()
            $total = $resp.ContentLength
            $in = $resp.GetResponseStream(); $out = [IO.File]::Create($Dest)
            try {
                $buf = New-Object byte[] 1048576; $done = 0; $last = -1
                while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
                    $out.Write($buf, 0, $n); $done += $n
                    if ($total -gt 0) {
                        $pct = [int](100 * $done / $total)
                        if ($pct -ne $last) {
                            Write-Host -NoNewline ("`r      Descargando... {0}%  ({1:N0} de {2:N0} MB)    " -f $pct, ($done / 1MB), ($total / 1MB))
                            $last = $pct
                        }
                    }
                }
                Write-Host ''
            } finally { $out.Dispose(); $in.Dispose(); $resp.Close() }
            return
        } catch {
            Write-Host ''
            try { if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue } } catch {}
            if ($try -ge 3) { throw "No se ha podido descargar $Url : $($_.Exception.Message)" }
            Write-Warn2 "La descarga ha fallado (intento $try de 3). Reintento..."
            Start-Sleep -Seconds (2 * $try)
        }
    }
}

# ---------- Servidor ----------
function Test-WillyPostHealth {
    # Devuelve $true si WillyPost responde en /api/health. Sin proxy (es una direccion local).
    try {
        $req = [Net.HttpWebRequest]::Create("http://127.0.0.1:$($global:WpPort)/api/health")
        $req.Proxy = $null
        $req.Timeout = 2000; $req.ReadWriteTimeout = 2000
        $resp = $req.GetResponse()
        try {
            $sr = New-Object IO.StreamReader($resp.GetResponseStream())
            $txt = $sr.ReadToEnd()
        } finally { $resp.Close() }
        return ($txt -match '"ok"\s*:\s*true')
    } catch { return $false }
}

function Test-PortFree([int]$Port) {
    # True si nadie esta escuchando en 127.0.0.1:Port
    $l = $null
    try {
        $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
        $l.ExclusiveAddressUse = $true
        $l.Start()
        return $true
    } catch { return $false }
    finally { if ($l) { try { $l.Stop() } catch {} } }
}

function Show-LogTail([string]$Path, [int]$Lines = 8) {
    try {
        if (Test-Path -LiteralPath $Path) {
            Write-Host '      Lo último que ha escrito WillyPost:' -ForegroundColor Gray
            Get-Content -LiteralPath $Path -Tail $Lines -Encoding UTF8 | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkGray }
        }
    } catch {}
}

function Wait-WillyPost([int]$Seconds = 40) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        if (Test-WillyPostHealth) { return $true }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Stop-WillyPostServer([string]$InstallDir) {
    # Para el servidor de WillyPost (y el túnel de medios, que es hijo suyo). No toca otros programas.
    $killed = $false
    if (Test-WillyPostHealth) {
        $ids = @()
        try {
            $ids = @(Get-NetTCPConnection -LocalPort $global:WpPort, ($global:WpPort + 1) -State Listen -ErrorAction SilentlyContinue |
                     Select-Object -ExpandProperty OwningProcess -Unique)
        } catch {}
        foreach ($id in $ids) {
            $p = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($p -and $p.ProcessName -eq 'node') { & taskkill.exe /PID $id /T /F *> $null; $killed = $true }
        }
    }
    if ($InstallDir) {
        try {
            $pattern = (([WildcardPattern]::Escape((Join-Path $InstallDir 'runtime'))) + '\*')
            $mine = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
                    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like $pattern }
            foreach ($p in $mine) { & taskkill.exe /PID $p.ProcessId /T /F *> $null; $killed = $true }
        } catch {}
    }
    if ($killed) { Start-Sleep -Milliseconds 800 }
    return $killed
}

# ---------- Accesos directos ----------
function New-WpShortcut {
    param([string]$Path, [string]$Target, [string]$Arguments = '', [string]$WorkDir = '', [string]$Icon = '',
          [string]$Description = '', [int]$WindowStyle = 1)
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($Path)
    $lnk.TargetPath = $Target
    if ($Arguments) { $lnk.Arguments = $Arguments }
    if ($WorkDir)   { $lnk.WorkingDirectory = $WorkDir }
    if ($Icon)      { $lnk.IconLocation = "$Icon,0" }
    if ($Description) { $lnk.Description = $Description }
    $lnk.WindowStyle = $WindowStyle
    $lnk.Save()
}

function Get-WpPaths {
    # Rutas de los accesos (respeta escritorios redirigidos a OneDrive, nombres con acentos, etc.)
    $desktop  = [Environment]::GetFolderPath('Desktop')
    $programs = [Environment]::GetFolderPath('Programs')
    $startup  = [Environment]::GetFolderPath('Startup')
    return [pscustomobject]@{
        Desktop     = Join-Path $desktop 'WillyPost.lnk'
        MenuDir     = Join-Path $programs 'WillyPost'
        MenuOpen    = Join-Path (Join-Path $programs 'WillyPost') 'WillyPost.lnk'
        MenuStop    = Join-Path (Join-Path $programs 'WillyPost') 'Detener WillyPost.lnk'
        MenuUninst  = Join-Path (Join-Path $programs 'WillyPost') 'Desinstalar WillyPost.lnk'
        Startup     = Join-Path $startup 'WillyPost.lnk'
        UninstKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyPost'
    }
}

function Get-WpDataDir {
    if ($env:WILLYPOST_DATA) { return $env:WILLYPOST_DATA }
    $base = $env:APPDATA
    if (-not $base) { $base = Join-Path $env:USERPROFILE 'AppData\Roaming' }
    return (Join-Path $base 'WillyPost')
}

function Get-WpInstallDir {
    if ($env:WILLYPOST_APP_DIR) { return $env:WILLYPOST_APP_DIR }
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = Join-Path $env:USERPROFILE 'AppData\Local' }
    return (Join-Path $base 'WillyPost\app')
}
