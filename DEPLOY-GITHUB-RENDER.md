# Deploy Korean Duo with GitHub Pages + Render

## 1. GitHub
Upload this entire directory to a new GitHub repository (keep `server.js`, `content/`, `public/`, and `docs/` at the repository root).

## 2. Render backend
- Dashboard > New > Web Service > connect the repository.
- Runtime: Node.
- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- Add environment variable `CLIENT_ORIGIN=https://YOUR-USERNAME.github.io` (no trailing slash). This is the browser **origin**, not the repository subpath.
- For a Pages custom domain, use the custom domain origin instead.
- Deploy with one running instance, because rooms live in server memory.
- Copy its URL, such as `https://korean-duo-server.onrender.com`.

## 3. Configure frontend
- Edit `docs/config.js` and replace `https://REPLACE-ME.onrender.com` with the actual Render URL (without trailing slash); commit.
- GitHub repo > Settings > Pages > Build and deployment > Deploy from a branch > `main` > `/docs` > Save.
- Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/` on two browsers.

## 4. Validate
- Open browser developer tools (Console/Network). Confirm `socket.io.js` loads from Render, WebSocket/long polling connects, and game illustrations load from Render.
- Player A creates a room, B joins, both submit, results appear.
- If `CLIENT_ORIGIN` changes, redeploy Render.

## Notes
- All hidden answer keys remain only on Render. `docs/` contains no answer keys.
- Free Render services may sleep, causing delayed first connections, and server restarts lose rooms.
- You can also use Render only: the same backend already serves the frontend at the Render URL, without GitHub Pages.
