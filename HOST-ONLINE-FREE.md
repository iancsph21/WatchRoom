# Keep TALWATCH available when your PC is off

The app needs an online server. Discord displays the Activity but does not run its server for you. A cloud deployment lets someone else host a screen while your PC is off. The person actually sharing their screen must keep their own computer and browser host tab running.

## Free option: Render

Render supports this Node.js app and its WebSocket video relay. Choose a **Free Web Service**, not a Static Site. A deployment configuration is included as `render.yaml`.

Free services sleep after 15 minutes without incoming traffic and usually take about a minute to wake. They have monthly usage limits, can restart, and are not a guaranteed always-on service. If bandwidth is exhausted, Render can bill overages when a payment method is present, or suspend free services when one is absent. Review your account's usage and spending settings. [Render free-service limits](https://render.com/docs/free)

Video is the main constraint: at 2 Mbps video plus 0.384 Mbps audio, the relay sends approximately **1.07 GB per viewer-hour** before overhead. Four simultaneous viewers use approximately **4.29 GB per hour** at that bitrate. Actual usage varies with the content. WebSocket traffic counts toward Render outbound bandwidth. [Render WebSocket documentation](https://render.com/docs/websocket)

## Deploy the included project

1. Create a GitHub repository and upload the contents of the `WatchRoom` folder. Put `package.json`, `server.js`, `render.yaml`, `client/`, and `stream-protocol.js` at the repository root. Include `package-lock.json` and the companion ZIP under `client/public/downloads/`. **Do not upload `.env`, `node_modules`, or private credentials.** The included `.gitignore` excludes them when using Git.
2. Sign in to [Render](https://dashboard.render.com/) and choose **New → Web Service**. Connect that repository.
3. Select **Node** and the **Free** instance. Use these settings:

   | Setting | Value |
   |---|---|
   | Build command | `npm ci --include=dev && npm run build` |
   | Start command | `npm start` |
   | Health check | `/healthz` |

4. Add environment variables in Render:

   | Name | Value |
   |---|---|
   | `DEMO_MODE` | `false` |
   | `HOST` | `0.0.0.0` |
   | `DISCORD_CLIENT_ID` | Your TALWATCH application Client ID |
   | `DISCORD_CLIENT_SECRET` | Your TALWATCH Client Secret, entered privately in Render |
   | `PUBLIC_ORIGIN` | The full HTTPS address Render assigns to this service |

   Let Render supply `PORT`. If the service URL is only shown after creation, add `PUBLIC_ORIGIN` then redeploy. You can also use Render's Blueprint flow with the supplied `render.yaml`.
5. Wait for deployment to succeed. Open the service's `/healthz` address; it should display `{"ok":true}`.
6. In Discord Developer Portal → TALWATCH → Activities → URL Mappings, set Prefix `/` and Target to the Render hostname **without `https://`**. Replace the temporary `trycloudflare.com` hostname.
7. Keep the OAuth2 redirect `https://127.0.0.1` already configured for the Embedded App SDK flow.
8. Close and reopen TALWATCH in Discord. Create a room, choose **Share screen**, and check that the browser host opens on your Render address. Friends can join through the room list.
9. After verifying the cloud version, you can close the local server and tunnel. TALWATCH no longer depends on your PC being on.

Use one server instance: rooms and connection state are held in memory. A restart or free-tier sleep clears rooms; users simply reopen the Activity and create a new room. No database is needed for this prototype.

## What has not been deployed yet

The project is ready to upload, but no Render account, GitHub repository, or cloud deployment has been created by this task. Your current Discord URL still points at the tunnel running on your PC until you perform the steps above.

Free hosting is suitable for trying the app with a small group. It cannot promise unlimited 30 FPS streaming, zero cold-start delay, or uninterrupted availability. Check current plan allowances in your account before relying on it for long watch parties.
