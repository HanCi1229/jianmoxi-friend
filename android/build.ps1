param(
    [Parameter(Mandatory)][string]$JavaHome,
    [Parameter(Mandatory)][string]$PlatformJar,
    [Parameter(Mandatory)][string]$BuildTools,
    [Parameter(Mandatory)][string]$Output,
    [string]$SigningDir = (Join-Path $env:LOCALAPPDATA 'JianmoxiFriendBuild/signing')
)

$ErrorActionPreference = 'Stop'
$java = Join-Path $JavaHome 'bin/java.exe'
$javac = Join-Path $JavaHome 'bin/javac.exe'
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
$aapt = Join-Path $BuildTools 'aapt2.exe'
$align = Join-Path $BuildTools 'zipalign.exe'
$d8 = Join-Path $BuildTools 'lib/d8.jar'
$signer = Join-Path $BuildTools 'lib/apksigner.jar'
$store = Join-Path $SigningDir 'friend-release.p12'
$password = Join-Path $SigningDir 'friend-release.pass'
$outputPath = [IO.Path]::GetFullPath($Output)

function Invoke-BuildTool([string]$Tool, [string[]]$ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Tool)) failed ($LASTEXITCODE)" }
}

$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char]92) + '\'
$job = Join-Path $temp ('jianmoxi-friend-android-' + [Guid]::NewGuid().ToString('N'))
$inJob = $false
try {
    New-Item -ItemType Directory -Path $job, (Join-Path $job 'classes'), (Join-Path $job 'dex'), $SigningDir, (Split-Path $outputPath) -Force | Out-Null
    $sourceFiles = 'res', 'src', 'AndroidManifest.xml' | ForEach-Object { Join-Path $PSScriptRoot $_ }
    Copy-Item -LiteralPath $sourceFiles -Destination $job -Recurse
    Copy-Item -LiteralPath $PlatformJar -Destination (Join-Path $job 'android.jar')
    Push-Location -LiteralPath $job
    $inJob = $true
    # Relative arguments avoid narrow-character path handling in Windows SDK executables.
    Invoke-BuildTool $aapt @('compile', '--dir', 'res', '-o', 'compiled.zip')
    Invoke-BuildTool $aapt @('link', '-I', 'android.jar', '--manifest', 'AndroidManifest.xml', '-o', 'unsigned.apk', 'compiled.zip')
    $sources = Get-ChildItem -LiteralPath 'src' -Filter '*.java' -Recurse | ForEach-Object { [IO.Path]::GetRelativePath($job, $_.FullName) }
    Invoke-BuildTool $javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', 'android.jar', '-d', 'classes') + $sources)
    $classFiles = Get-ChildItem -LiteralPath 'classes' -Filter '*.class' -Recurse | ForEach-Object { [IO.Path]::GetRelativePath($job, $_.FullName) }
    Invoke-BuildTool $java (@('-cp', $d8, 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', 'android.jar', '--output', 'dex') + $classFiles)
    $archive = [IO.Compression.ZipFile]::Open((Join-Path $job 'unsigned.apk'), [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($file in Get-ChildItem -LiteralPath 'dex' -Filter '*.dex') {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $file.Name) | Out-Null
        }
    } finally { $archive.Dispose() }
    Invoke-BuildTool $align @('-f', '-p', '4', 'unsigned.apk', 'aligned.apk')

    $hasStore = Test-Path -LiteralPath $store
    $hasPassword = Test-Path -LiteralPath $password
    if ($hasStore -ne $hasPassword) { throw 'Android signing files are incomplete' }
    if (!$hasStore) {
        $secret = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        [IO.File]::WriteAllText($password, [Convert]::ToBase64String($secret))
        try {
            Invoke-BuildTool $keytool @('-genkeypair', '-keystore', $store, '-storetype', 'PKCS12', '-storepass:file', $password,
                '-alias', 'friend', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Jianmoxi Friend,O=Jianmoxi')
        } catch {
            if (!(Test-Path -LiteralPath $store)) { Remove-Item -LiteralPath $password }
            throw
        }
    }
    Invoke-BuildTool $java @('-jar', $signer, 'sign', '--ks', $store, '--ks-key-alias', 'friend', '--ks-pass', ('file:' + $password),
        '--v4-signing-enabled', 'false', '--out', 'signed.apk', 'aligned.apk')
    Invoke-BuildTool $java @('-jar', $signer, 'verify', '--verbose', 'signed.apk')
    Invoke-BuildTool $align @('-c', '-p', '4', 'signed.apk')
    Copy-Item -LiteralPath 'signed.apk' -Destination $outputPath -Force
    Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
} finally {
    if ($inJob) { Pop-Location }
    $resolved = [IO.Path]::GetFullPath($job)
    if ($resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
