# CLI deployment

## 1. Install and authenticate tools

```powershell
npm install
npm exec firebase -- login
gcloud auth login
gcloud auth application-default login
```

Google Cloud CLI installation (if missing):

```powershell
winget install --exact --id Google.CloudSDK
```

Restart the shell after installation.

## 2. Create the Firebase project

Try the preferred IDs in order. Project IDs are globally unique and become the `web.app` subdomain.

```powershell
npm exec firebase -- projects:create apexbot --display-name "ApexBot"
# If unavailable:
npm exec firebase -- projects:create apex-bot --display-name "ApexBot"
npm exec firebase -- use --add
```

Set `.firebaserc` to the successful ID and set `FIREBASE_PROJECT_ID` in `.env`.

Create Firestore:

```powershell
gcloud firestore databases create --location=asia-south1 --type=firestore-native --project=$env:FIREBASE_PROJECT_ID
```

## 3. Discord application and secrets

Discord does not expose supported CLI/API creation of developer applications. Create the application once in the Discord Developer Portal, call it **ApexBot**, enable Message Content and Server Members intents, and copy the bot token/client ID/client secret into the local environment. All subsequent registration and deployment is CLI-driven.

Create secrets without putting values in shell history:

```powershell
./scripts/set-secrets.ps1
```

Add OAuth redirect URIs:

```text
https://<project-id>.web.app/api/auth/discord/callback
http://localhost:8080/api/auth/discord/callback
```

## 4. Build, test, and deploy

```powershell
npm run test
npm run typecheck
npm run build
npm run deploy:firebase
npm run deploy:cloudrun -- -ProjectId $env:FIREBASE_PROJECT_ID
npm run deploy:commands
```

Firebase Hosting rewrites `/api/**` to the `apexbot` Cloud Run service in `asia-south1`.

## 5. Invite the bot

```text
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=1101927019638&scope=bot%20applications.commands
```

Place the ApexBot role above roles it must moderate. Run `/mode standby`, configure logging and moderator channels in the dashboard, observe for at least a day, then use `/mode active`.

## Rollback

```powershell
gcloud run revisions list --service apexbot --region asia-south1
gcloud run services update-traffic apexbot --region asia-south1 --to-revisions <revision>=100
npm exec firebase -- hosting:clone <project-id>:<good-version> <project-id>:live
```
