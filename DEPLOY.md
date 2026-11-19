# Publish DugoutX

The app is prepared for a Render web service. Its public `onrender.com` address stays the same when game fixes are deployed.

## First deployment

1. Push this project to the new GitHub repository. Include `src/`, `data/ai/`, `data/ml/`, `package.json`, `package-lock.json`, and `render.yaml`. Keep `.env.local`, `firebase-service-account.json`, and `data/dev-db*.json` out of GitHub; `.gitignore` excludes them.
2. In Render, select **New → Blueprint**, connect the GitHub repository, and select its `render.yaml`. The Blueprint creates a Node web service in Singapore with automatic deployments from the connected branch.
3. When Render asks for environment values, copy the seven `NEXT_PUBLIC_FIREBASE_*` values from your local `.env.local`. For `FIREBASE_SERVICE_ACCOUNT_JSON`, paste the entire JSON content of your local `firebase-service-account.json`. Render keeps this value in its private environment settings.
4. Wait for the first build to finish and open the `https://...onrender.com` address shown by Render.
5. In Firebase Console, open **Authentication → Settings → Authorized domains** and add only the new hostname, without `https://`. This enables Google sign-in on the public site.

The hosted app stores rooms and seasons in Firestore. It does not treat the temporary Render filesystem as a database. On the free Render plan, the service can take time to wake after being idle.

## Updates

Test a change locally, then push it to the GitHub branch linked to Render. Render automatically builds and deploys it at the same public address. If a Firebase environment value changes, update it in Render and choose **Save, rebuild, and deploy**.
