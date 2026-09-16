# WATCH TALIM

A Discord Activity for browser screen sharing, with an optional Windows companion for PC control. Start with QUICK-START.md for the current no-download hosting flow.

The live version targets 720p at 30 FPS. Host a room, choose Share screen, and select a tab or window in the browser picker. Friends watch inside TALWATCH. The companion is optional and only required for PC control. See QUICK-START.md for usage and HOST-ONLINE-FREE.md for cloud hosting.

## Try it locally

Double-click Start-Local-Preview.cmd, open http://localhost:3000, and create a room. A second browser tab can join from Available rooms. Choose Share screen to open the browser host page. The local-only test animation exercises the stream without capturing your screen.

## Connect it to Discord

The app uses Discord's official Embedded App SDK and OAuth identification. It does not need a bot token or your Discord password.

1. Create an application at https://discord.com/developers/applications. For testing with friends, use a developer team and add the testers; unpublished Activities have development access restrictions.
2. Enable Activities and the desktop platform in the application's settings. Enable Developer Mode in your Discord client. Discord creates a default Activity entry point when Activities are enabled.
3. Add `https://127.0.0.1` as the OAuth2 redirect URI, following Discord's Activity tutorial.
4. Copy `.env.example` to `.env`. Set `DEMO_MODE=false`. Enter the application's Client ID and Client Secret there. Keep the secret on the server; do not paste it in Discord or commit this file.
5. In the project folder, run:

   ```powershell
   npm ci
   npm run build
   npm start
   ```

6. Provide a public HTTPS address forwarding to port 3000, with WebSocket support. For development, a tunnel such as `cloudflared tunnel --url http://localhost:3000` can provide one after you install that tool. Use a stable domain for ongoing use. **Do not expose local demo mode**; it intentionally blocks forwarded/public requests and does not verify identities.
7. In Activity URL Mappings, map `/` to your HTTPS hostname (without `https://`). Both `/api` and `/ws` use this mapping.
8. Launch WATCH TALIM from Discord's Activity launcher in a voice channel. Sign in and choose Host a room. Friends choose your name from Available rooms. Rooms are visible to all signed-in app users across Discord channels.
9. Set PUBLIC_ORIGIN in .env to your public HTTPS server address and restart the server. Click Share screen in the room to open the browser host page, then choose a tab or window in the browser picker. No companion is required for sharing.
10. Friends join the room and click Enable sound if wanted. For optional PC control, the host can separately download and pair the companion; each control request needs local approval.

If launching fails, first check that demo mode is disabled, credentials are correct, the HTTPS address is reachable, `/` is mapped, and the tester has development access. Production hosts may require `HOST=0.0.0.0`; keep TLS on the reverse proxy and enable WebSockets. This prototype stores rooms in memory, so run one server process; a restart ends every session.

## Using the app

See QUICK-START.md for screen sharing, sound, fullscreen, the room list, and optional PC control. See HOST-ONLINE-FREE.md for deployment steps and bandwidth limits.

## Development

Run `npm ci`, `npm run build`, and `npm test`. The Python companion tests use `python -m unittest discover -s tests -p "test_*.py"` after installing its dependencies. The source includes a browser host, VP8/WebSocket relay, canvas decoder, and optional Windows input adapter. No Discord bot token is required.

The Node service stores rooms in memory; run a single instance. The companion ZIP served at `/downloads/WATCH-TALIM-Companion.zip` is included under `client/public/downloads/`.
