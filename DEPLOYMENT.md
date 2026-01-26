# Cloud Run Deployment Guide

This guide explains how to deploy OpenBookings to Google Cloud Run.

## Prerequisites

1. Google Cloud Project with billing enabled
2. Cloud Build API enabled
3. Cloud Run API enabled
4. Artifact Registry repository created
5. Firebase project configured

## Required Environment Variables

The following environment variables must be set in your Cloud Build trigger or via substitution variables:

### Build-time Variables (NEXT_PUBLIC_*)
These are embedded into the Next.js build and must be available during Docker build:

- `_NEXT_PUBLIC_FIREBASE_API_KEY` - Firebase Web API Key
- `_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` - Firebase Auth Domain (usually `PROJECT_ID.firebaseapp.com`)
- `_NEXT_PUBLIC_FIREBASE_PROJECT_ID` - Firebase Project ID
- `_NEXT_PUBLIC_FIREBASE_APP_ID` - Firebase App ID
- `_NEXT_PUBLIC_APP_URL` - Your application URL (e.g., `https://openbookings.co`)

### Runtime Variables (Optional)
These are used by Firebase Admin SDK on the server:

- `FIREBASE_SERVICE_ACCOUNT_KEY` - JSON string of Firebase service account (optional, uses Application Default Credentials if not set)
- `FIREBASE_PROJECT_ID` - Firebase Project ID (if not using service account JSON)
- `FIREBASE_CLIENT_EMAIL` - Service account email (if not using service account JSON)
- `FIREBASE_PRIVATE_KEY` - Service account private key (if not using service account JSON)

**Note:** For Cloud Run, Application Default Credentials are recommended. Ensure your Cloud Run service account has the "Firebase Admin SDK Administrator Service Agent" role.

## Setting Up Cloud Build Substitution Variables

### Option 1: Via Cloud Console

1. Go to Cloud Build > Triggers
2. Edit your trigger
3. Under "Substitution variables", add:
   - `_NEXT_PUBLIC_FIREBASE_API_KEY` = your Firebase API key
   - `_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = your Firebase auth domain
   - `_NEXT_PUBLIC_FIREBASE_PROJECT_ID` = your Firebase project ID
   - `_NEXT_PUBLIC_FIREBASE_APP_ID` = your Firebase app ID
   - `_NEXT_PUBLIC_APP_URL` = your application URL

### Option 2: Via gcloud CLI

```bash
gcloud builds triggers create github \
  --repo-name=OpenBookings \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --substitutions=_NEXT_PUBLIC_FIREBASE_API_KEY="your-api-key",_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com",_NEXT_PUBLIC_FIREBASE_PROJECT_ID="your-project-id",_NEXT_PUBLIC_FIREBASE_APP_ID="your-app-id",_NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

### Option 3: Via Secret Manager (Recommended for Production)

For sensitive values, use Secret Manager:

1. Create secrets:
```bash
echo -n "your-api-key" | gcloud secrets create NEXT_PUBLIC_FIREBASE_API_KEY --data-file=-
echo -n "your-project.firebaseapp.com" | gcloud secrets create NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN --data-file=-
# ... repeat for other variables
```

2. Grant Cloud Build access:
```bash
gcloud secrets add-iam-policy-binding NEXT_PUBLIC_FIREBASE_API_KEY \
  --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

3. Update `cloudbuild.yaml` to use secrets (modify the build step):
```yaml
steps:
  - name: gcr.io/cloud-builders/gcloud
    entrypoint: bash
    args:
      - -c
      - |
        export NEXT_PUBLIC_FIREBASE_API_KEY=$(gcloud secrets versions access latest --secret=NEXT_PUBLIC_FIREBASE_API_KEY)
        export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$(gcloud secrets versions access latest --secret=NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
        # ... repeat for other secrets
        docker build \
          --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=$$NEXT_PUBLIC_FIREBASE_API_KEY \
          --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
          # ... repeat for other build args
          -t $_AR_HOSTNAME/$PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA .
```

## Deployment

The `cloudbuild.yaml` file is configured to:

1. Build the Docker image with build-time environment variables
2. Push the image to Artifact Registry
3. Deploy to Cloud Run with runtime environment variables

### Required Cloud Build Substitution Variables

Make sure these are set in your Cloud Build trigger:
- `_AR_HOSTNAME` - Artifact Registry hostname (e.g., `us-central1-docker.pkg.dev`)
- `_AR_REPOSITORY` - Artifact Registry repository name
- `_SERVICE_NAME` - Cloud Run service name
- `_DEPLOY_REGION` - Deployment region (e.g., `us-central1`)
- `_PLATFORM` - Platform (usually `managed`)

## Troubleshooting

### Firebase Environment Variables Not Working

If you're getting errors about missing Firebase environment variables:

1. **Build-time errors**: Ensure `_NEXT_PUBLIC_*` variables are set as substitution variables in your Cloud Build trigger
2. **Runtime errors**: Check that environment variables are set in Cloud Run service configuration
3. **Verify values**: Check Cloud Run logs to see what values are being used

### "Get Started" Button Not Working

The login modal should now work correctly with the z-index fix. If issues persist:
- Check browser console for JavaScript errors
- Verify that `FocusOverlay` component is rendering
- Check that React portal is working (requires `document.body`)

### Port Issues

Cloud Run automatically sets the `PORT` environment variable. The application is configured to:
- Default to port 8080 if `PORT` is not set
- Listen on `0.0.0.0` to accept connections from Cloud Run's load balancer

## Security Notes

- `NEXT_PUBLIC_*` variables are embedded in the client-side bundle and are publicly visible
- Never put secrets in `NEXT_PUBLIC_*` variables
- Use Secret Manager for sensitive server-side variables
- Firebase Admin SDK uses Application Default Credentials in Cloud Run (recommended)
