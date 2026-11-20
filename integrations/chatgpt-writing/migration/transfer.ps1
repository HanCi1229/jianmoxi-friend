$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$cfg=[Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
$folder=[IO.Path]::GetFullPath($cfg.output)
[IO.Directory]::CreateDirectory($folder) | Out-Null
$common=@{TimeoutSec=120}
if($cfg.proxy){$common.Proxy=$cfg.proxy}
$manifestPath=Join-Path $folder 'manifest.json'
if($cfg.mode -eq 'download') {
    $headers=@{Authorization=('Bearer '+$cfg.source_token)}
    Invoke-WebRequest -Uri ($cfg.source_url+'?export=manifest.json') -Headers $headers -OutFile $manifestPath @common | Out-Null
}
if(-not (Test-Path -LiteralPath $manifestPath)){throw 'Source manifest is not available'}
$manifest=[IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json -AsHashtable
if($manifest.format -ne 1 -or $manifest.snapshot -notmatch '^migration-\d+$'){throw 'Invalid export manifest'}
$total=$manifest.files.Count
$done=0
$bytes=0L
if($cfg.mode -eq 'upload') {
    $headers=@{Authorization=('Bearer '+$cfg.migration_token);'OAI-Sites-Authorization'=('Bearer '+$cfg.site_access)}
    $body=@{snapshot=$manifest.snapshot;counts=$manifest.counts}|ConvertTo-Json -Compress
    Invoke-RestMethod -Uri ($cfg.site_url+'/admin/start') -Method POST -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) @common | Out-Null
}
$manifest.files | ForEach-Object -ThrottleLimit 6 -Parallel {
    $ErrorActionPreference='Stop'
    $ProgressPreference='SilentlyContinue'
    $config=$using:cfg
    $entry=$_
    $targetFolder=$using:folder
    if($entry.file -notmatch '^(workspace\.json|legacy-owner\.json\.gz|work-[A-Za-z0-9_-]{1,100}\.jmx)$'){throw 'Invalid export filename'}
    $path=[IO.Path]::GetFullPath((Join-Path $targetFolder $entry.file))
    if(-not $path.StartsWith($targetFolder+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Export path outside staging'}
    $options=@{TimeoutSec=120}
    if($config.proxy){$options.Proxy=$config.proxy}
    for($attempt=0;$attempt -lt 4;$attempt++) {
        try {
            if($config.mode -eq 'download') {
                $valid=(Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Length -eq $entry.bytes)
                if($valid){$valid=((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() -eq $entry.sha256)}
                if(-not $valid) {
                    $partial=$path+'.partial'
                    $head=@{Authorization=('Bearer '+$config.source_token)}
                    Invoke-WebRequest -Uri ($config.source_url+'?export='+[uri]::EscapeDataString($entry.file)) -Headers $head -OutFile $partial @options | Out-Null
                    if((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256){throw 'Source checksum mismatch'}
                    Move-Item -LiteralPath $partial -Destination $path -Force
                }
            } elseif($config.mode -eq 'upload') {
                if(-not (Test-Path -LiteralPath $path)){throw 'Source file missing'}
                if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256){throw 'Local checksum mismatch'}
                $head=@{Authorization=('Bearer '+$config.migration_token);'OAI-Sites-Authorization'=('Bearer '+$config.site_access);'x-content-sha256'=$entry.sha256}
                Invoke-WebRequest -Uri ($config.site_url+'/admin/object?key='+[uri]::EscapeDataString($entry.key)) -Method PUT -Headers $head -ContentType 'application/octet-stream' -InFile $path @options | Out-Null
            } else {throw 'Unknown transfer mode'}
            break
        } catch {
            if($attempt -eq 3){throw ('Transfer failed for '+$entry.file+': '+$_.Exception.Message)}
            Start-Sleep -Milliseconds (500*($attempt+1))
        }
    }
    [pscustomobject]@{bytes=[long]$entry.bytes}
} | ForEach-Object {
    $done++
    $bytes+=$_.bytes
    if($done % 50 -eq 0 -or $done -eq $total){Write-Output ($cfg.mode+': '+$done+'/'+$total+' objects, '+[math]::Round($bytes/1MB,1)+' MiB verified')}
}
if($cfg.mode -eq 'upload') {
    $workspace=[IO.File]::ReadAllText((Join-Path $folder 'workspace.json'))|ConvertFrom-Json -AsHashtable
    $body=@{snapshot=$manifest.snapshot;workspace=$workspace}|ConvertTo-Json -Depth 100 -Compress
    Invoke-RestMethod -Uri ($cfg.site_url+'/admin/workspace') -Method POST -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) @common | Out-Null
    $works=@($manifest.files|Where-Object kind -eq 'work')
    for($offset=0;$offset -lt $works.Count;$offset+=50) {
        $end=[math]::Min($offset+49,$works.Count-1)
        $body=@{snapshot=$manifest.snapshot;works=@($works[$offset..$end])}|ConvertTo-Json -Depth 100 -Compress
        Invoke-RestMethod -Uri ($cfg.site_url+'/admin/works') -Method POST -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) @common | Out-Null
        Write-Output ('Book metadata: '+($end+1)+'/'+$works.Count)
    }
    $body=@{snapshot=$manifest.snapshot}|ConvertTo-Json -Compress
    $status=Invoke-RestMethod -Uri ($cfg.site_url+'/admin/complete') -Method POST -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) @common
    $status|ConvertTo-Json -Compress
}
Write-Output ($cfg.mode+' finished; all transferred objects passed SHA256 validation.')
