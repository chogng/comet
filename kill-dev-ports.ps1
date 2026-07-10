$ErrorActionPreference = 'Stop'
$Ports = @(1420, 1421)

function Get-ListeningPidsByPort {
  param(
    [int[]]$TargetPorts
  )

  $pidSet = New-Object 'System.Collections.Generic.HashSet[int]'
  $lines = netstat -ano -p tcp

  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $trimmed = $line.Trim()
    if (-not $trimmed.StartsWith('TCP')) {
      continue
    }

    $parts = $trimmed -split '\s+'
    if ($parts.Length -lt 4) {
      continue
    }

    $localAddress = $parts[1]
    $pidText = $parts[$parts.Length - 1]

    $ownerPid = 0
    if (-not [int]::TryParse($pidText, [ref]$ownerPid)) {
      continue
    }

    if ($ownerPid -le 0 -or $ownerPid -eq $PID) {
      continue
    }

    foreach ($port in $TargetPorts) {
      if ($localAddress.EndsWith(":$port")) {
        [void]$pidSet.Add($ownerPid)
        break
      }
    }
  }

  return @($pidSet)
}

$targetText = ($Ports -join ', ')
$pids = Get-ListeningPidsByPort -TargetPorts $Ports

if ($pids.Length -eq 0) {
  exit 0
}

Write-Host "[predev] cleaning stale listeners on ports $targetText"
foreach ($ownerPid in $pids) {
  try {
    $taskkillOutput = taskkill /PID $ownerPid /T /F 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[predev] killed pid $ownerPid"
    } else {
      $message = ($taskkillOutput | Out-String).Trim()
      Write-Warning "[predev] failed to kill pid ${ownerPid}: $message"
    }
  } catch {
    Write-Warning "[predev] failed to kill pid ${ownerPid}: $($_.Exception.Message)"
  }
}
