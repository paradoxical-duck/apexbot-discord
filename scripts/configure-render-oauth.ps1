param(
  [string]$SourceServiceId = 'srv-d7u9uapj2pic739mnbr0',
  [string]$TargetServiceId = 'srv-d9vvqnu1egvs73fhtf7g'
)

$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.render/cli.yaml') -Raw
$match = [regex]::Match($config, '(?m)^\s+key:\s*"?([^"\r\n]+)"?\s*$')
if (-not $match.Success) { throw 'Render CLI API key was not found.' }
$token = $match.Groups[1].Value.Trim()
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/json'; 'Content-Type' = 'application/json' }

try {
  $source = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$SourceServiceId/env-vars" -Headers $headers
  $target = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$TargetServiceId/env-vars" -Headers $headers
  $clientSecret = ($source | Where-Object { $_.envVar.key -eq 'DISCORD_CLIENT_SECRET' } | Select-Object -First 1).envVar.value
  if (-not $clientSecret) { throw 'The source service does not contain DISCORD_CLIENT_SECRET.' }

  $values = @{}
  foreach ($entry in $target) { $values[$entry.envVar.key] = $entry.envVar.value }
  $values['DISCORD_CLIENT_SECRET'] = $clientSecret
  $values['DISCORD_REDIRECT_URI'] = 'https://mod-ai.onrender.com/callback'
  $values['DASHBOARD_URL'] = 'https://apexbot-5lco.onrender.com'
  $values['API_BASE_URL'] = 'https://apexbot-5lco.onrender.com'
  $values['GEMINI_MODEL'] = 'gemini-flash-latest'

  $body = @($values.GetEnumerator() | ForEach-Object { @{ key = $_.Key; value = $_.Value } }) | ConvertTo-Json -Depth 4
  Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$TargetServiceId/env-vars" -Headers $headers -Body $body | Out-Null

  $sourceValues = @{}
  foreach ($entry in $source) { $sourceValues[$entry.envVar.key] = $entry.envVar.value }
  $sourceValues['NODE_ENV'] = 'production'
  $sourceValues['PORT'] = '8080'
  $sourceValues['OAUTH_BRIDGE_TARGET'] = 'https://apexbot-5lco.onrender.com'
  $sourceBody = @($sourceValues.GetEnumerator() | ForEach-Object { @{ key = $_.Key; value = $_.Value } }) | ConvertTo-Json -Depth 4
  Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$SourceServiceId/env-vars" -Headers $headers -Body $sourceBody | Out-Null
  [pscustomobject]@{ Configured = $true; RedirectUri = $values['DISCORD_REDIRECT_URI']; DashboardUrl = $values['DASHBOARD_URL'] }
} finally {
  $clientSecret = $null
  $token = $null
}
