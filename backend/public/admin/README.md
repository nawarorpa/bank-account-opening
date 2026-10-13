# Administrator Review Portal

Open `/admin/` on the Node server. The portal never connects directly to Oracle from the browser. The server uses the Oracle credentials and exposes only authenticated admin API endpoints.

Development URL on the same PC:

- http://localhost:4000/admin/

From another device on the LAN, use the PC's current LAN IP followed by `/admin/`.

Configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` in `backend/.env` before use.
