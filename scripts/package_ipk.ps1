param(
    [string]$PackageRoot = ".",
    [string]$OutputDir = ".\release",
    [string]$PackageName = "luci-app-drcom-auth",
    [string]$Version = "1.0.0-1",
    [string]$Architecture = "all"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-ToUnixPath {
    param([string]$Path)
    return $Path.Replace("\", "/").TrimStart("/")
}

function New-TarBytes {
    param([array]$Entries)

    $out = New-Object System.IO.MemoryStream
    foreach ($entry in $Entries) {
        $name = Convert-ToUnixPath $entry.Name
        if ($entry.Type -eq "dir" -and -not $name.EndsWith("/")) {
            $name += "/"
        }

        $data = [byte[]]::new(0)
        if ($entry.Type -eq "file") {
            $data = [System.IO.File]::ReadAllBytes($entry.Source)
        } elseif ($entry.Type -eq "content") {
            $data = [System.Text.Encoding]::UTF8.GetBytes($entry.Content)
        }

        $header = [byte[]]::new(512)
        $ascii = [System.Text.Encoding]::ASCII
        $nameBytes = $ascii.GetBytes($name)
        if ($nameBytes.Length -gt 100) {
            throw "Tar path is too long for ustar header: $name"
        }
        [Array]::Copy($nameBytes, 0, $header, 0, $nameBytes.Length)

        $mode = "{0:0000000}" -f $entry.Mode
        [Array]::Copy($ascii.GetBytes($mode), 0, $header, 100, 7)
        $header[107] = 0
        [Array]::Copy($ascii.GetBytes("0000000"), 0, $header, 108, 7)
        [Array]::Copy($ascii.GetBytes("0000000"), 0, $header, 116, 7)

        $sizeOctal = [Convert]::ToString($data.Length, 8).PadLeft(11, "0")
        [Array]::Copy($ascii.GetBytes($sizeOctal), 0, $header, 124, 11)
        $header[135] = 0

        $mtime = [Convert]::ToString([int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds(), 8).PadLeft(11, "0")
        [Array]::Copy($ascii.GetBytes($mtime), 0, $header, 136, 11)
        $header[147] = 0

        for ($i = 148; $i -lt 156; $i++) {
            $header[$i] = 32
        }
        $header[156] = if ($entry.Type -eq "dir") { [byte][char]"5" } else { [byte][char]"0" }
        [Array]::Copy($ascii.GetBytes("ustar"), 0, $header, 257, 5)
        [Array]::Copy($ascii.GetBytes("00"), 0, $header, 263, 2)

        $sum = 0
        foreach ($b in $header) { $sum += $b }
        $check = [Convert]::ToString($sum, 8).PadLeft(6, "0")
        [Array]::Copy($ascii.GetBytes($check), 0, $header, 148, 6)
        $header[154] = 0
        $header[155] = 32

        $out.Write($header, 0, $header.Length)
        if ($data.Length -gt 0) {
            $out.Write($data, 0, $data.Length)
            $pad = (512 - ($data.Length % 512)) % 512
            if ($pad -gt 0) { $out.Write([byte[]]::new($pad), 0, $pad) }
        }
    }

    $out.Write([byte[]]::new(1024), 0, 1024)
    return $out.ToArray()
}

function Compress-Gzip {
    param([byte[]]$Bytes)
    $out = New-Object System.IO.MemoryStream
    $gz = New-Object System.IO.Compression.GzipStream($out, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    $gz.Write($Bytes, 0, $Bytes.Length)
    $gz.Dispose()
    return $out.ToArray()
}

function Convert-ToLf {
    param([string]$Text)
    $normalized = $Text -replace "`r`n", "`n" -replace "`r", "`n"
    if (-not $normalized.EndsWith("`n")) { $normalized += "`n" }
    return $normalized
}

function Test-IsTextPackagePath {
    param([string]$Path)
    $unix = Convert-ToUnixPath $Path
    return $unix -like "etc/config/*" `
        -or $unix -like "etc/init.d/*" `
        -or $unix -like "usr/share/drcom-auth/*.sh" `
        -or $unix -like "usr/share/drcom-auth/config.sh.template" `
        -or $unix -like "usr/share/luci/menu.d/*.json" `
        -or $unix -like "usr/share/rpcd/acl.d/*.json" `
        -or $unix -like "www/luci-static/resources/view/*.js"
}

$packageRootPath = Resolve-Path -LiteralPath $PackageRoot
$outputPath = Join-Path (Resolve-Path -LiteralPath ".").Path $OutputDir
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$postinst = @'
#!/bin/sh
[ -n "$IPKG_INSTROOT" ] || {
	chmod 755 /etc/init.d/drcom_auth 2>/dev/null || true
	chmod 755 /usr/share/drcom-auth/*.sh 2>/dev/null || true
	uci -q delete drcom_auth.main.term_mac
	uci -q delete drcom_auth.main.wlan_ac_ip
	uci -q delete drcom_auth.main.wlan_ac_name
	uci -q delete drcom_auth.main.login_method
	uci -q delete drcom_auth.main.authex_enable
	uci -q delete drcom_auth.main.js_version
	uci -q commit drcom_auth
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null || true
}
exit 0
'@
$postinst = Convert-ToLf $postinst

$conffiles = "/etc/config/drcom_auth`n"

$dirs = @(
    "./etc/", "./etc/config/", "./etc/init.d/",
    "./usr/", "./usr/share/", "./usr/share/drcom-auth/",
    "./usr/share/luci/", "./usr/share/luci/menu.d/",
    "./usr/share/rpcd/", "./usr/share/rpcd/acl.d/",
    "./www/", "./www/luci-static/", "./www/luci-static/resources/",
    "./www/luci-static/resources/view/"
)
$dataEntries = @()
foreach ($d in $dirs) { $dataEntries += @{ Name = $d; Type = "dir"; Mode = 755 } }

$rootDir = Join-Path $packageRootPath "root"
foreach ($file in (Get-ChildItem -LiteralPath $rootDir -Recurse -File)) {
    $relative = $file.FullName.Substring($rootDir.Length).TrimStart("\", "/")
    $mode = if ($relative -like "etc\init.d\*" -or $relative -like "usr\share\drcom-auth\*.sh") { 755 } else { 644 }
    $packagePath = Convert-ToUnixPath $relative
    if (Test-IsTextPackagePath $packagePath) {
        $content = Convert-ToLf ([System.IO.File]::ReadAllText($file.FullName))
        $dataEntries += @{ Name = "./$packagePath"; Type = "content"; Content = $content; Mode = $mode }
    } else {
        $dataEntries += @{ Name = "./$packagePath"; Type = "file"; Source = $file.FullName; Mode = $mode }
    }
}

$htdocsDir = Join-Path $packageRootPath "htdocs"
foreach ($file in (Get-ChildItem -LiteralPath $htdocsDir -Recurse -File)) {
    $relative = $file.FullName.Substring($htdocsDir.Length).TrimStart("\", "/")
    $packagePath = "www/" + (Convert-ToUnixPath $relative)
    if (Test-IsTextPackagePath $packagePath) {
        $content = Convert-ToLf ([System.IO.File]::ReadAllText($file.FullName))
        $dataEntries += @{ Name = "./$packagePath"; Type = "content"; Content = $content; Mode = 644 }
    } else {
        $dataEntries += @{ Name = "./$packagePath"; Type = "file"; Source = $file.FullName; Mode = 644 }
    }
}

$dataTar = New-TarBytes $dataEntries
$dataTarGz = Compress-Gzip $dataTar
$installedSize = $dataTar.Length

$control = @"
Package: $PackageName
Version: $Version
Architecture: $Architecture
Maintainer: azurekiln
Section: luci
Priority: optional
Depends: libc, luci-base, curl, openssl-util
Installed-Size: $installedSize
Description: LuCI panel for HSTC Dr.COM captive-portal authentication
"@
$control = Convert-ToLf $control

$controlEntries = @(
    @{ Name = "./control"; Type = "content"; Content = $control; Mode = 644 },
    @{ Name = "./postinst"; Type = "content"; Content = $postinst; Mode = 755 },
    @{ Name = "./conffiles"; Type = "content"; Content = $conffiles; Mode = 644 }
)

$controlTarGz = Compress-Gzip (New-TarBytes $controlEntries)
$debianBinary = [System.Text.Encoding]::ASCII.GetBytes("2.0`n")

$ipkPath = Join-Path $outputPath "$PackageName`_$Version`_$Architecture.ipk"
$debugDir = Join-Path $outputPath "ipk-debug"
New-Item -ItemType Directory -Force -Path $debugDir | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $debugDir "control.tar.gz"), $controlTarGz)
[System.IO.File]::WriteAllBytes((Join-Path $debugDir "data.tar.gz"), $dataTarGz)
[System.IO.File]::WriteAllBytes((Join-Path $debugDir "debian-binary"), $debianBinary)
if (Test-Path -LiteralPath $ipkPath) { Remove-Item -LiteralPath $ipkPath -Force }
& tar --format=ustar -czf $ipkPath -C $debugDir ./debian-binary ./data.tar.gz ./control.tar.gz
if ($LASTEXITCODE -ne 0) { throw "tar failed to create $ipkPath" }

$hash = (Get-FileHash -LiteralPath $ipkPath -Algorithm SHA256).Hash.ToLower()
$shaPath = "$ipkPath.sha256.txt"
Set-Content -LiteralPath $shaPath -Value "$hash *$(Split-Path -Leaf $ipkPath)" -Encoding ASCII

Get-Item -LiteralPath $ipkPath, $shaPath | Select-Object FullName, Length
