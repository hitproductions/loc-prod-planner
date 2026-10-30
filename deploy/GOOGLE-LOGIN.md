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

**Once**, store the client secret in Google Secret Manager. Run from the repository root; it
asks for the secret with hidden typing, and also lets the planner's service account read it:

```bash
deploy/cloudrun.sh --setup-secret
```

Run it again only if the secret is changed in the Google Cloud console.

**Every deploy** after that needs nothing typed. The client ID is built into the script and the
secret is read from Secret Manager:

```bash
deploy/cloudrun.sh --public            # editing copy
deploy/cloudrun.sh --public --view     # read-only copy
```

Optional settings, exported in the same terminal before deploying:

| Variable | Meaning |
|---|---|
| `PLANNER_GOOGLE_DOMAIN` | Allowed Workspace domain. Default `hitproductions.net`. |
| `PLANNER_GOOGLE_ALLOW` | Comma-separated extra addresses allowed outside the domain (verified by Google). |
| `PLANNER_PUBLIC_URL` | Only if the app sits behind a proxy that hides its real address. |

## How it behaves

- A signed-out visitor sees the Hit logo, the artwork (by Hit's own artist) framed as a camera viewfinder, and a single **Sign in with Google** button. The artwork, logo and font in `webapp/public/login/` and `fonts/` are the only files served before sign-in.
- An account outside the domain and not on the allow list is refused and told which account to use.
- Sessions last 7 days. A person removed from the allow list, or whose Workspace account is closed, is locked out on their next request or next sign-in. Changing the client secret signs everyone out.
- Changes are accepted only from the app's own page, as JSON, from a signed-in person.
- History gets a **By** column. On first use the app adds a `by` column to the History tab by itself.
- If the client ID is set but the secret is missing, the app refuses everything rather than opening up.

## One link: engineers see the read-only view

Everyone uses the same address. Who gets what is decided by the **Engineers** tab:

1. Add a column headed `email` to the Engineers tab (row 1, any position).
2. Type each engineer's Hit Google address in it, one per engineer. Capitals do not matter.

A signed-in person whose address is in that column gets the read-only engineer view, and the server refuses any change they send. Everyone else at Hit gets the full planner. Edits to the column apply within a few minutes, no redeploy.

**An engineer with no address in the column can edit.** Fill it in for everyone, Daryl included, before sharing the link.

The separate read-only service keeps working, so nothing breaks while people switch. It can be retired later.

## Check after deploying

1. Open the Cloud Run URL signed out: only the Google button shows.
2. Sign in with a company account: the schedule opens, your name shows top right, **Logout** works.
3. Try a personal Gmail: refused.
4. Make a change, open **History**: your name is in **By**.
5. Put a test address in the Engineers `email` column and sign in with it: the read-only engineer view opens, on the same link.
