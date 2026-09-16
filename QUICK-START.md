# WATCH TALIM · Browser hosting

Close and reopen TALWATCH after updating.

## Share without installing anything

1. Click **Host a room** in TALWATCH.
2. Click **Share screen · no download**. A browser host page opens.
3. On that page, click **Share screen · target 30 FPS** and choose the browser tab, window, or screen you want to share.
4. For YouTube/Instagram sound, share a browser tab and enable **Share tab audio** in the browser picker. Microphone audio is not captured.
5. Keep the browser host page open. Friends click **Join room** under your name in Available rooms, then **Enable sound** if they want audio.

Use desktop Chrome or Edge for hosting. The encoder targets up to 1280×720 at 30 FPS with roughly 2 Mbps video; actual rate depends on capture content, hardware, network and the Discord client. A static screen may produce fewer frames. The host page displays the actual outgoing frame rate and bitrate.

Video uses VP8 over WebSockets and displays inside the Activity. Audio is mono 24 kHz. It is a live relay, not a saved recording. Viewers with a slow connection wait for a fresh keyframe rather than accumulating an ever-longer queue. The relay server can see the media; transport uses HTTPS/WSS, not end-to-end encryption.

Click **Stop sharing** on the browser host page, **Stop browser screen share** in your room, or the browser's built-in sharing stop control to end the stream. Closing the host tab also stops it.

## Watching

Choose your friend's name from **Available rooms**. No room code or companion is needed. Rooms are visible to everyone signed into this TALWATCH app, across Discord channels. Choose Small, Medium, Large, or Fullscreen above the picture. Escape or Exit fullscreen returns to the normal view. If Discord blocks native fullscreen, it fills the Activity instead.

## Optional PC control

The **Download optional Windows companion (.zip)** button appears at the bottom of TALWATCH and on the browser host page. Only the person allowing control needs it. Install Python 3.12+ on Windows, extract the ZIP, and run Start-Companion.cmd.

In the host's room, expand **Optional: let friends control your PC**, download the companion pairing file, and use **Open host file** in the companion. Pairing files expire after 2 minutes. Approve sharing locally, then approve a friend's control request. F8 stops companion sharing and control.

Remote mouse, keyboard, next/previous Reel and auto-scroll need this companion. Browser-only sharing cannot inject input into another tab or application. While a viewer has PC control, their picture switches to the companion's low-frame-rate primary-monitor preview so mouse coordinates match. Releasing control returns to the browser video. The companion and browser stream have separate Stop buttons.

## Hosting while the owner's PC is off

See **HOST-ONLINE-FREE.md** for Render setup and free-plan limits. No cloud deployment has been made yet. The person sharing a screen must still keep their own PC on.

## Validation

Relay tests cover one-use owner-authorized browser host links, binary video permissions, stream epoch validation, cached frames for late viewers, and the existing companion permission gates. Local synthetic-video testing verifies encoding, relaying and decoding without capturing private screen content. Real Discord playback and capture frame rate depend on the selected client and connection.
