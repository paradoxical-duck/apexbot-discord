param([string]$ProjectId = $env:FIREBASE_PROJECT_ID)
$ErrorActionPreference = "Stop"
if (-not $ProjectId) { throw "Set FIREBASE_PROJECT_ID or pass -ProjectId." }

function Set-ApexSecret([string]$Name, [string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $value | gcloud secrets versions add $Name --data-file=- --project=$ProjectId 2>$null
    if ($LASTEXITCODE -ne 0) {
      $value | gcloud secrets create $Name --data-file=- --replication-policy=automatic --project=$ProjectId
    }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

Set-ApexSecret "discord-token" "Discord bot token"
Set-ApexSecret "discord-client-secret" "Discord OAuth client secret"
Set-ApexSecret "gemini-api-key" "Gemini API key"
Set-ApexSecret "cookie-secret" "Random 32+ character cookie secret"
