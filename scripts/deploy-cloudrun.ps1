param(
  [string]$ProjectId = $env:FIREBASE_PROJECT_ID,
  [string]$Region = "asia-south1",
  [string]$Service = "apexbot",
  [string]$DiscordClientId = $env:DISCORD_CLIENT_ID
)
$ErrorActionPreference = "Stop"
if (-not $ProjectId) { throw "Set FIREBASE_PROJECT_ID or pass -ProjectId." }
if (-not $DiscordClientId) { throw "Set DISCORD_CLIENT_ID or pass -DiscordClientId." }
$publicUrl = "https://$ProjectId.web.app"
gcloud config set project $ProjectId
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com firestore.googleapis.com
gcloud artifacts repositories describe apexbot --location $Region --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud artifacts repositories create apexbot --repository-format=docker --location=$Region --project=$ProjectId
}
gcloud builds submit --tag "$Region-docker.pkg.dev/$ProjectId/apexbot/$Service:latest"
gcloud run deploy $Service --image "$Region-docker.pkg.dev/$ProjectId/apexbot/$Service:latest" --region $Region --platform managed --allow-unauthenticated --min-instances 1 --max-instances 1 --cpu 1 --memory 512Mi --no-cpu-throttling --set-env-vars "FIREBASE_PROJECT_ID=$ProjectId,NODE_ENV=production,AI_PROVIDER=gemini,DISCORD_CLIENT_ID=$DiscordClientId,DISCORD_REDIRECT_URI=$publicUrl/api/auth/discord/callback,DASHBOARD_URL=$publicUrl,API_BASE_URL=$publicUrl" --set-secrets "DISCORD_TOKEN=discord-token:latest,DISCORD_CLIENT_SECRET=discord-client-secret:latest,GEMINI_API_KEY=gemini-api-key:latest,COOKIE_SECRET=cookie-secret:latest"
