# WillyPost - fabrica "Instalar-WillyPost.exe" con IExpress (viene con Windows: no hace falta instalar nada).
# Uso (desde la carpeta del repositorio, en Windows):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\exe\build-exe.ps1
# Resultado: docs\descargas\Instalar-WillyPost.exe  (GitHub Pages lo sirve en https://willypost.com/descargas/Instalar-WillyPost.exe)
#
# Cómo funciona el .exe: IExpress empaqueta instalar-willypost.cmd + descargar-e-instalar.ps1 (plantilla:
# Instalar-WillyPost.sed). Al abrirlo, Windows los descomprime en una carpeta temporal, ejecuta el .cmd en una
# ventana normal (sin pedir permisos de administrador: el manifiesto de IExpress es "asInvoker") y borra la
# carpeta al terminar. El .ps1 descarga la última versión de la rama main y lanza scripts\windows\instalar.ps1.
# Por eso NO hace falta reconstruir el .exe en cada versión: solo si cambias algo de esta carpeta.
#
# Después de IExpress, este script cambia con la API de Windows (UpdateResource) el icono (el de WillyPost)
# y los datos de "Propiedades > Detalles" (IExpress pondría "Microsoft Corporation / Internet Explorer").
# La plantilla .sed no admite comentarios (IExpress falla si los tiene): las explicaciones van aquí.
param([string]$Out = '')

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Repo = [IO.Path]::GetFullPath((Join-Path $Here '..\..\..'))
if (-not $Out) { $Out = Join-Path $Repo 'docs\descargas\Instalar-WillyPost.exe' }
$Out = [IO.Path]::GetFullPath($Out)
$Icon = Join-Path $Repo 'scripts\willypost.ico'

$iexpress = Join-Path $env:SystemRoot 'System32\iexpress.exe'
if (-not (Test-Path -LiteralPath $iexpress)) { throw "No encuentro IExpress en $iexpress (viene con Windows 10/11)." }

$version = '1.0.0'
try { $version = (Get-Content -LiteralPath (Join-Path $Repo 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {}
$fileVersion = ((($version -replace '[^0-9.]', '').Split('.') | Where-Object { $_ -ne '' }) + @('0', '0', '0', '0'))[0..3] -join '.'

# IExpress (y makecab) se llevan mal con rutas largas o con espacios: se trabaja en una carpeta corta de TEMP.
$stage = Join-Path $env:TEMP ('wpexe-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
# IExpress no acepta la ruta del .sed entre comillas: si TEMP tiene espacios, se usa la ruta corta (8.3)
if ($stage -match ' ') { try { $stage = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($stage).ShortPath } catch {} }
try {
    # Copiar el lanzador forzando el formato que necesita Windows: CRLF; el .ps1 en UTF-8 con BOM (acentos en PS 5.1)
    $ps1 = [IO.File]::ReadAllText((Join-Path $Here 'descargar-e-instalar.ps1')) -replace "`r?`n", "`r`n"
    [IO.File]::WriteAllText((Join-Path $stage 'descargar-e-instalar.ps1'), $ps1, (New-Object Text.UTF8Encoding($true)))
    $cmd = [IO.File]::ReadAllText((Join-Path $Here 'instalar-willypost.cmd')) -replace "`r?`n", "`r`n"
    if ($cmd -match '[^\x00-\x7F]') { throw 'instalar-willypost.cmd debe ser solo ASCII (sin acentos).' }
    [IO.File]::WriteAllText((Join-Path $stage 'instalar-willypost.cmd'), $cmd, (New-Object Text.ASCIIEncoding))

    $tmpExe = Join-Path $stage 'Instalar-WillyPost.exe'
    $sed = [IO.File]::ReadAllText((Join-Path $Here 'Instalar-WillyPost.sed'))
    $sed = $sed.Replace('{{TARGET}}', $tmpExe).Replace('{{SOURCEDIR}}', $stage + '\')
    $sedPath = Join-Path $stage 'paquete.sed'
    [IO.File]::WriteAllText($sedPath, ($sed -replace "`r?`n", "`r`n"), (New-Object Text.ASCIIEncoding))

    Write-Host "Construyendo con IExpress..."
    $p = Start-Process -FilePath $iexpress -ArgumentList @('/N', '/Q', '/M', $sedPath) -Wait -PassThru -WindowStyle Hidden
    if (-not (Test-Path -LiteralPath $tmpExe)) { throw "IExpress no ha generado el .exe (código $($p.ExitCode))." }

    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class WpExeRes {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr h);
    delegate bool EnumNamesProc(IntPtr h, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangsProc(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr param);
    [DllImport("kernel32.dll")] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumNamesProc cb, IntPtr param);
    [DllImport("kernel32.dll")] static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumLangsProc cb, IntPtr param);
    const int RT_ICON = 3, RT_GROUP_ICON = 14, RT_VERSION = 16;
    const ushort LANG_ES = 0x0C0A;

    // (id, idioma) de los recursos con id numerico de un tipo
    static List<KeyValuePair<int, ushort>> List(string exe, int type) {
        var res = new List<KeyValuePair<int, ushort>>();
        IntPtr h = LoadLibraryEx(exe, IntPtr.Zero, 0x2 /* LOAD_LIBRARY_AS_DATAFILE */);
        if (h == IntPtr.Zero) throw new Exception("No puedo abrir " + exe);
        try {
            EnumResourceNames(h, (IntPtr)type, (hm, t, name, p) => {
                if (((long)name >> 16) != 0) return true;
                int id = (int)name;
                EnumResourceLanguages(hm, t, name, (hm2, t2, n2, lang, p2) => { res.Add(new KeyValuePair<int, ushort>(id, lang)); return true; }, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);
        } finally { FreeLibrary(h); }
        return res;
    }

    static void Put(IntPtr h, int type, int id, ushort lang, byte[] data) {
        if (!UpdateResource(h, (IntPtr)type, (IntPtr)id, lang, data, data == null ? 0u : (uint)data.Length))
            throw new Exception("UpdateResource(" + type + "/" + id + "): error " + Marshal.GetLastWin32Error());
    }

    // ---- VS_VERSIONINFO ----
    static void Align(BinaryWriter w) { while (w.BaseStream.Position % 4 != 0) w.Write((byte)0); }
    // Escribe un bloque {wLength, wValueLength, wType, szKey, Value, Children} y devuelve sus bytes
    static byte[] Block(string key, byte[] value, ushort valueLength, ushort type, List<byte[]> children) {
        var ms = new MemoryStream(); var w = new BinaryWriter(ms);
        w.Write((ushort)0); w.Write(valueLength); w.Write(type);
        w.Write(Encoding.Unicode.GetBytes(key + "\0")); Align(w);
        if (value != null) { w.Write(value); }
        if (children != null) foreach (var c in children) { Align(w); w.Write(c); }
        byte[] b = ms.ToArray();
        BitConverter.GetBytes((ushort)b.Length).CopyTo(b, 0);
        return b;
    }
    static byte[] VersionInfo(string version, Dictionary<string, string> strings) {
        var p = version.Split('.'); var v = new ushort[4];
        for (int i = 0; i < 4; i++) v[i] = (ushort)(i < p.Length ? int.Parse(p[i]) : 0);
        var fi = new MemoryStream(); var w = new BinaryWriter(fi);
        w.Write(0xFEEF04BDu); w.Write(0x00010000u);
        uint ms = ((uint)v[0] << 16) | v[1], ls = ((uint)v[2] << 16) | v[3];
        w.Write(ms); w.Write(ls); w.Write(ms); w.Write(ls);
        w.Write(0x3Fu); w.Write(0u); w.Write(0x40004u /* VOS_NT_WINDOWS32 */); w.Write(1u /* VFT_APP */); w.Write(0u); w.Write(0u); w.Write(0u);
        var strs = new List<byte[]>();
        foreach (var kv in strings) {
            byte[] val = Encoding.Unicode.GetBytes(kv.Value + "\0");
            strs.Add(Block(kv.Key, val, (ushort)(kv.Value.Length + 1), 1, null));
        }
        var table = Block("0C0A04B0", null, 0, 1, strs);
        var sfi = Block("StringFileInfo", null, 0, 1, new List<byte[]> { table });
        var tr = new byte[4]; BitConverter.GetBytes(LANG_ES).CopyTo(tr, 0); BitConverter.GetBytes((ushort)1200).CopyTo(tr, 2);
        var vfi = Block("VarFileInfo", null, 0, 1, new List<byte[]> { Block("Translation", tr, 4, 0, null) });
        return Block("VS_VERSION_INFO", fi.ToArray(), 52, 0, new List<byte[]> { sfi, vfi });
    }

    public static void Apply(string exe, string ico, string version, string[] keys, string[] values) {
        var icons = List(exe, RT_ICON);
        var groups = List(exe, RT_GROUP_ICON);
        var versions = List(exe, RT_VERSION);
        var strings = new Dictionary<string, string>();
        for (int i = 0; i < keys.Length; i++) strings[keys[i]] = values[i];
        IntPtr h = BeginUpdateResource(exe, false);
        if (h == IntPtr.Zero) throw new Exception("BeginUpdateResource: error " + Marshal.GetLastWin32Error());
        bool ok = false;
        try {
            // Datos de "Propiedades > Detalles"
            foreach (var kv in versions) Put(h, RT_VERSION, kv.Key, kv.Value, null);
            Put(h, RT_VERSION, 1, LANG_ES, VersionInfo(version, strings));
            // Icono
            if (!string.IsNullOrEmpty(ico) && File.Exists(ico)) {
                byte[] f = File.ReadAllBytes(ico);
                int count = BitConverter.ToUInt16(f, 4);
                int baseId = 1;
                foreach (var kv in icons) if (kv.Key >= baseId) baseId = kv.Key + 1;
                ushort lang = groups.Count > 0 ? groups[0].Value : (ushort)1033;
                int groupId = groups.Count > 0 ? groups[0].Key : 1;
                foreach (var kv in groups) Put(h, RT_GROUP_ICON, kv.Key, kv.Value, null);
                foreach (var kv in icons) Put(h, RT_ICON, kv.Key, kv.Value, null);
                var grp = new MemoryStream(); var w = new BinaryWriter(grp);
                w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
                for (int i = 0; i < count; i++) {
                    int e = 6 + 16 * i;
                    int size = BitConverter.ToInt32(f, e + 8), offset = BitConverter.ToInt32(f, e + 12);
                    byte[] img = new byte[size];
                    Array.Copy(f, offset, img, 0, size);
                    Put(h, RT_ICON, baseId + i, lang, img);
                    w.Write(f, e, 12);              // ancho, alto, colores, reservado, planos, bits, tamaño
                    w.Write((ushort)(baseId + i));  // id del RT_ICON
                }
                Put(h, RT_GROUP_ICON, groupId, lang, grp.ToArray());
            }
            ok = true;
        } finally {
            if (!EndUpdateResource(h, !ok) && ok) throw new Exception("EndUpdateResource: error " + Marshal.GetLastWin32Error());
        }
    }
}
'@
    $keys = @('CompanyName', 'FileDescription', 'FileVersion', 'InternalName', 'LegalCopyright', 'OriginalFilename', 'ProductName', 'ProductVersion')
    $vals = @('Nuria Olive Soler - Willy SEO Academy', 'Instalador de WillyPost', $version, 'Instalar-WillyPost', 'Nuria Olive Soler. Licencia en github.com/NuriaAtlantis/willypost', 'Instalar-WillyPost.exe', 'WillyPost', $version)
    try {
        [WpExeRes]::Apply($tmpExe, $Icon, $fileVersion, [string[]]$keys, [string[]]$vals)
        Write-Host 'Icono y datos de WillyPost puestos.'
    } catch {
        Write-Warning "No he podido poner el icono ni los datos del archivo ($($_.Exception.Message)). El .exe funciona igual."
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
    Copy-Item -LiteralPath $tmpExe -Destination $Out -Force
    $kb = [math]::Round((Get-Item -LiteralPath $Out).Length / 1KB)
    Write-Host "Hecho: $Out ($kb KB)"
}
finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
