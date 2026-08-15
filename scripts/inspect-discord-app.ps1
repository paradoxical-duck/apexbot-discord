$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$secure = ConvertTo-SecureString (Get-Content -LiteralPath (Join-Path $root 'artifacts/.discord-token.dpapi') -Raw)
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $headers = @{ Authorization = "Bot $token"; 'User-Agent' = 'DiscordBot (https://github.com/paradoxical-duck/apexbot-discord, 0.1.0)' }
  $application = Invoke-RestMethod -Uri 'https://discord.com/api/v10/applications/@me' -Headers $headers
  [pscustomobject]@{
    Id = $application.id
    Name = $application.name
    RedirectUris = @($application.redirect_uris)
    BotPublic = $application.bot_public
  }
} finally {
  $token = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
