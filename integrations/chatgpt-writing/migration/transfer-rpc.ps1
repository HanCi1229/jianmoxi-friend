param([hashtable]$Config)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$folder=[IO.Path]::GetFullPath($Config.output)
$manifest=[IO.File]::ReadAllText((Join-Path $folder 'manifest.json'))|ConvertFrom-Json -AsHashtable
$plan=[IO.File]::ReadAllText((Join-Path $folder 'rpc-jobs-v3.json'))|ConvertFrom-Json -AsHashtable
$headers=@{Authorization=('Bearer '+$Config.migration_token);'OAI-Sites-Authorization'=('Bearer '+$Config.site_access)}
$options=@{TimeoutSec=120;MaximumRedirection=0}
if($Config.no_proxy){$options.NoProxy=$true}elseif($Config.proxy){$options.Proxy=$Config.proxy}
$script:connection=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
function Send-Rpc([string]$Operation,$Payload) {
    $inner=$Payload|ConvertTo-Json -Depth 100 -Compress
    $outer=@{operation=$Operation;payload=$inner}|ConvertTo-Json -Depth 3 -Compress
    $body=[Text.Encoding]::UTF8.GetBytes($outer)
    for($attempt=0;$attempt -lt 12;$attempt++) {
        try { return Invoke-RestMethod -Uri ($Config.site_url+'/admin/rpc') -Method POST -Headers $headers -ContentType 'application/json' -Body $body -WebSession $script:connection @options }
        catch {
            $response=$_.Exception.Response
            if($response -and [int]$response.StatusCode -ge 400 -and [int]$response.StatusCode -lt 500 -and [int]$response.StatusCode -ne 429){throw}
            if($attempt -eq 11){throw}
            $script:connection=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
            if($attempt%3 -eq 0){$why=if($response){'HTTP '+[int]$response.StatusCode}else{$_.Exception.GetType().Name};[Console]::WriteLine('Retrying '+$Operation+' ('+$why+'); verified receipts retained.')}
            Start-Sleep -Milliseconds (300+200*$attempt)
        }
    }
}
$state=Send-Rpc 'status' @{}
if($state.ready){Write-Output ($state|ConvertTo-Json -Compress);return}
if(-not (Send-Rpc 'start' @{snapshot=$manifest.snapshot;counts=$manifest.counts}).started){throw 'Migration did not start'}
$receipt=Join-Path $folder ('rpc-v3-uploaded-'+$manifest.snapshot+'.txt')
$completed=[Collections.Generic.HashSet[int]]::new()
if(Test-Path -LiteralPath $receipt){foreach($value in [IO.File]::ReadAllLines($receipt)){[void]$completed.Add([int]$value)}}
$functionBody=${function:Send-Rpc}.ToString()
$initial=$completed
$recorded=[Collections.Generic.HashSet[int]]::new($completed)
$lanes=if($Config.concurrency){[int]$Config.concurrency}else{3}
0..($lanes-1)|ForEach-Object -ThrottleLimit $lanes -Parallel {
    $ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
    $lane=$_;$count=$using:lanes;$all=$using:plan;$initial=$using:initial;$dir=$using:folder
    $Config=$using:Config;$headers=$using:headers;$options=$using:options
    $script:connection=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    Set-Item -Path Function:\Send-Rpc -Value ([scriptblock]::Create($using:functionBody))
    for($index=$lane;$index -lt $all.jobs.Count;$index+=$count) {
        if($initial.Contains($index)){[pscustomobject]@{index=$index;skipped=$true};continue}
        $job=$all.jobs[$index]
        try {
            if($job.operation -eq 'objects') {
                $files=@();foreach($file in $job.files){$path=[IO.Path]::GetFullPath((Join-Path $dir $file.file));if(-not $path.StartsWith($dir+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Source outside staging'};$files+=@{key=$file.key;sha256=$file.sha256;bytes=$file.bytes;data=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path))}};$payload=@{files=$files}
            } else {
                $path=[IO.Path]::GetFullPath((Join-Path $dir $job.file));if(-not $path.StartsWith($dir+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Source outside staging'}
                $stream=[IO.File]::OpenRead($path);try{$stream.Position=[long]$job.offset;$bytes=[byte[]]::new([int]$job.length);$stream.ReadExactly($bytes)}finally{$stream.Dispose()}
                $payload=@{key=$job.key;index=$job.index;sha256=$job.sha256;data=[Convert]::ToBase64String($bytes)}
            }
            $result=Send-Rpc $job.operation $payload
            if(-not $result.stored){throw 'No verified object receipt returned'}
            [pscustomobject]@{index=$index;skipped=$false}
            Start-Sleep -Milliseconds 100
        } catch {[pscustomobject]@{index=$index;failed=$true;message=$_.Exception.Message};return}
    }
}|ForEach-Object {
    if($_.failed){throw ('Job '+$_.index+' remains resumable: '+$_.message)}
    if(-not $_.skipped -and $recorded.Add([int]$_.index)){[IO.File]::AppendAllText($receipt,[string]$_.index+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))}
    if($recorded.Count%20 -eq 0 -or $recorded.Count -eq $plan.jobs.Count){Write-Output ('Verified chunk batches: '+$recorded.Count+'/'+$plan.jobs.Count)}
}
$finishReceipt=Join-Path $folder ('rpc-finished-'+$manifest.snapshot+'.txt')
$finished=[Collections.Generic.HashSet[int]]::new()
if(Test-Path -LiteralPath $finishReceipt){foreach($value in [IO.File]::ReadAllLines($finishReceipt)){[void]$finished.Add([int]$value)}}
for($i=0;$i -lt $plan.finish.Count;$i++) {
    if(-not $finished.Contains($i)){
        if(-not (Send-Rpc 'finish_object' $plan.finish[$i]).stored){throw 'Whole-file checksum receipt missing'}
        [IO.File]::AppendAllText($finishReceipt,[string]$i+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    }
    if(($i+1)%10 -eq 0 -or $i+1 -eq $plan.finish.Count){Write-Output ('Assembled verified books: '+($i+1)+'/'+$plan.finish.Count)}
}
$workspace=[IO.File]::ReadAllText((Join-Path $folder 'workspace.json'))|ConvertFrom-Json -AsHashtable
Send-Rpc 'workspace' @{snapshot=$manifest.snapshot;workspace=$workspace}|Out-Null
$works=@($manifest.files|Where-Object kind -eq 'work')
for($offset=0;$offset -lt $works.Count;$offset+=12){$end=[math]::Min($offset+11,$works.Count-1);Send-Rpc 'works' @{snapshot=$manifest.snapshot;works=@($works[$offset..$end])}|Out-Null;Write-Output ('Verified book metadata: '+($end+1)+'/'+$works.Count)}
$result=Send-Rpc 'complete' @{snapshot=$manifest.snapshot}
if(-not $result.ready){throw 'Import did not pass final counts'}
Write-Output ($result|ConvertTo-Json -Compress)
