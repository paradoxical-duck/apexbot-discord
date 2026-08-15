param(
  [string]$ServiceName = 'apexbot'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$render = Join-Path $root '.tools/render/cli_v2.22.0.exe'

function Read-ProtectedSecret([string]$Path) {
  $secure = ConvertTo-SecureString (Get-Content -LiteralPath $Path -Raw)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$discordToken = Read-ProtectedSecret (Join-Path $root 'artifacts/.discord-token.dpapi')
$geminiKey = Read-ProtectedSecret (Join-Path $root 'artifacts/.gemini-key.dpapi')
$cookieBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($cookieBytes)
$cookieSecret = [Convert]::ToBase64String($cookieBytes)
$serviceUrl = "https://$ServiceName.onrender.com"

try {
  $result = & $render services create `
    --name $ServiceName `
    --type web_service `
    --repo 'https://github.com/paradoxical-duck/apexbot-discord' `
    --branch main `
    --runtime docker `
    --plan free `
    --region singapore `
    --health-check-path '/api/health' `
    --auto-deploy=true `
    --env-var 'NODE_ENV=production' `
    --env-var 'PORT=8080' `
    --env-var 'AI_PROVIDER=gemini' `
    --env-var 'GEMINI_MODEL=gemini-flash-latest' `
    --env-var 'DISCORD_CLIENT_ID=1501215133345648801' `
    --env-var "DISCORD_TOKEN=$discordToken" `
    --env-var "GEMINI_API_KEY=$geminiKey" `
    --env-var "COOKIE_SECRET=$cookieSecret" `
    --env-var "DASHBOARD_URL=$serviceUrl" `
    --env-var "API_BASE_URL=$serviceUrl" `
    --env-var "DISCORD_REDIRECT_URI=$serviceUrl/api/auth/discord/callback" `
    --confirm `
    --output json
  if ($LASTEXITCODE -ne 0) { throw "Render service creation failed with exit code $LASTEXITCODE." }
  $service = $result | ConvertFrom-Json
  [pscustomobject]@{
    Id = $service.id
    Name = $service.name
    Type = $service.type
    Url = $service.serviceDetails.url
  }
} finally {
  $discordToken = $null
  $geminiKey = $null
  $cookieSecret = $null
}
