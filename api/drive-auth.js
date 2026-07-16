module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<script>window.opener.postMessage({ type: 'DRIVE_AUTH_ERROR', error: '${error}' }, '*');window.close();</script>`);
  }
  if (!code) return res.status(400).send("Missing code");
  try {
    const params = new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/drive-auth`,
      grant_type:    "authorization_code",
    });
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const tokens = await tokenResp.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);
    return res.status(200).send(`<!DOCTYPE html><html><body><script>window.opener.postMessage({ type: 'DRIVE_AUTH_SUCCESS', access_token: '${tokens.access_token}', expires_in: ${tokens.expires_in || 3600} }, '*');window.close();</script></body></html>`);
  } catch (err) {
    return res.status(500).send(`<script>window.opener.postMessage({ type: 'DRIVE_AUTH_ERROR', error: '${err.message}' }, '*');window.close();</script>`);
  }
};
