# Sign in with Google (replaces the shared password)

Everyone signs in with their own **@hitproductions.net** Google account. History then shows who made each change. The shared password stops working on any copy that has Google sign-in configured.

Local runs and a LAN box are unchanged: with no `PLANNER_GOOGLE_CLIENT_ID` set, nothing asks for a login.

## One-time setup (Tara, in the Google Cloud console, project `loc-prod-planner`)

1. **APIs & Services → OAuth consent screen**: user type **Internal** (only Hit Productions accounts can ever sign in). App name "Loc Prod Planner".
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorized redirect URIs**, one per copy, exactly:
   - `https://planner-63803252709.asia-southeast1.run.app/auth/google/callback`
   - `https://planner-view-63803252709.asia-southeast1.run.app/auth/google/callback`
4. Keep the **Client ID** and **Client secret**. The secret is a password: do not paste it into chat, email or the repository.

## Deploy

Run from the repository root. The secret is prompted for (hidden), not typed as an argument:

```bash
export PLANNER_GOOGLE_CLIENT_ID=<client id>
deploy/cloudrun.sh --public            # editing copy
deploy/cloudrun.sh --public --view     # read-only copy
```

Optional environment variables, set the same way:

| Variable | Meaning |
|---|---|
| `PLANNER_GOOGLE_DOMAIN` | Allowed Workspace domain. Default `hitproductions.net`. |
| `PLANNER_GOOGLE_ALLOW` | Comma-separated extra addresses allowed outside the domain (verified by Google). |
| `PLANNER_PUBLIC_URL` | Only if the app sits behind a proxy that hides its real address. |

## How it behaves

- A signed-out visitor sees the Hit logo, the animated artwork (by Hit's own artist) and a single **Sign in with Google** button. The artwork, logo and font in `webapp/public/login/` and `fonts/` are the only files served before sign-in.
- An account outside the domain and not on the allow list is refused and told which account to use.
- Sessions last 7 days. A person removed from the allow list, or whose Workspace account is closed, is locked out on their next request or next sign-in. Changing the client secret signs everyone out.
- Changes are accepted only from the app's own page, as JSON, from a signed-in person.
- History gets a **By** column. On first use the app adds a `by` column to the History tab by itself.
- If the client ID is set but the secret is missing, the app refuses everything rather than opening up.

## Check after deploying

1. Open the Cloud Run URL signed out: only the Google button shows.
2. Sign in with a company account: the schedule opens, your name shows top right, **Logout** works.
3. Try a personal Gmail: refused.
4. Make a change, open **History**: your name is in **By**.
