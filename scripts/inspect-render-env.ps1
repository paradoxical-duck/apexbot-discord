param([Parameter(Mandatory = $true)][string]$ServiceId)

$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.render/cli.yaml') -Raw
$match = [regex]::Match($config, '(?m)^\s+key:\s*"?([^"\r\n]+)"?\s*$')
if (-not $match.Success) { throw 'Render CLI API key was not found.' }
$token = $match.Groups[1].Value.Trim()
try {
  $headers = @{ Authorization = "Bearer $token"; Accept = 'application/json' }
  $variables = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$ServiceId/env-vars" -Headers $headers
  $variables | ForEach-Object { $_.envVar.key } | Sort-Object
} finally {
  $token = $null
}
