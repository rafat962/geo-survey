/**
 * Cloudflare Worker for Field App
 * Reads users from `env.AUTH_USERS` (JSON object string: {"username":"password"}),
 * issues HMAC-SHA256 signed HttpOnly cookies, and protects app routes.
 */

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBuffer(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function strToBase64Url(str) {
  return bufferToBase64Url(new TextEncoder().encode(str));
}

function base64UrlToStr(b64url) {
  return new TextDecoder().decode(base64UrlToBuffer(b64url));
}

async function getCryptoKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createToken(username, maxAgeSec, secret) {
  const exp = Date.now() + maxAgeSec * 1000;
  const payloadJson = JSON.stringify({ u: username, exp });
  const b64Payload = strToBase64Url(payloadJson);
  const key = await getCryptoKey(secret);
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(b64Payload)
  );
  return `${b64Payload}.${bufferToBase64Url(sigBuffer)}`;
}

async function verifyToken(token, secret, users) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64Payload, b64Sig] = parts;

  try {
    const key = await getCryptoKey(secret);
    const sigBytes = base64UrlToBuffer(b64Sig);
    const dataBytes = new TextEncoder().encode(b64Payload);

    const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlToStr(b64Payload));
    if (!payload.u || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    if (users && !Object.prototype.hasOwnProperty.call(users, payload.u)) {
      return null;
    }

    return payload.u;
  } catch (err) {
    return null;
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const c of cookies) {
    const [k, ...v] = c.trim().split("=");
    if (k === name) {
      return decodeURIComponent(v.join("="));
    }
  }
  return null;
}

function parseAuthUsers(rawUsers) {
  if (!rawUsers) {
    return { error: "Missing AUTH_USERS environment variable" };
  }
  if (typeof rawUsers === "object") {
    return {
      users: rawUsers,
      secret: JSON.stringify(rawUsers)
    };
  }
  if (typeof rawUsers === "string") {
    try {
      const parsed = JSON.parse(rawUsers);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "AUTH_USERS must be a JSON object mapping usernames to passwords" };
      }
      return { users: parsed, secret: rawUsers };
    } catch (err) {
      return { error: "Invalid AUTH_USERS JSON format" };
    }
  }
  return { error: "Invalid AUTH_USERS format" };
}

export default {
  async fetch(request, env) {
    const parsedAuth = parseAuthUsers(env.AUTH_USERS);
    if (parsedAuth.error) {
      return new Response(parsedAuth.error, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    const USERS = parsedAuth.users;
    const secretKeyStr = env.AUTH_SECRET || parsedAuth.secret;
    const url = new URL(request.url);
    const pathname = url.pathname;
    const secureFlag = url.protocol === "https:" ? "; Secure" : "";

    // 1. POST /api/login
    if (pathname === "/api/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const { username, password, remember } = body || {};

        if (
          username &&
          typeof username === "string" &&
          password &&
          typeof password === "string" &&
          Object.prototype.hasOwnProperty.call(USERS, username) &&
          USERS[username] === password
        ) {
          const maxAgeSec = remember ? 30 * 86400 : 12 * 3600;
          const token = await createToken(username, maxAgeSec, secretKeyStr);
          const cookie = `auth_token=${token}; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=${maxAgeSec}`;

          return new Response(
            JSON.stringify({ success: true, user: username }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "Set-Cookie": cookie
              }
            }
          );
        }
      } catch (err) {}

      return new Response(
        JSON.stringify({
          success: false,
          message: "اسم المستخدم أو كلمة المرور غير صحيحة"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // 2. GET /api/session
    if (pathname === "/api/session" && request.method === "GET") {
      const token = getCookie(request, "auth_token");
      const user = await verifyToken(token, secretKeyStr, USERS);

      if (user) {
        return new Response(
          JSON.stringify({ authenticated: true, user }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            }
          }
        );
      }

      return new Response(JSON.stringify({ authenticated: false }), {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    // 3. POST /api/logout & GET /api/logout
    if (
      pathname === "/api/logout" &&
      (request.method === "POST" || request.method === "GET")
    ) {
      const clearCookie = `auth_token=; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=0`;
      const headers = new Headers();
      headers.set("Set-Cookie", clearCookie);
      headers.set("Cache-Control", "no-store");

      if (
        request.method === "POST" &&
        request.headers.get("Accept")?.includes("application/json")
      ) {
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(
          JSON.stringify({ success: true, redirect: "/login/" }),
          { status: 200, headers }
        );
      }

      headers.set("Location", "/login/");
      return new Response(null, { status: 302, headers });
    }

    // Normalize /login -> /login/
    if (pathname === "/login") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login/" }
      });
    }

    // 4. Route Protection Middleware
    const token = getCookie(request, "auth_token");
    const user = await verifyToken(token, secretKeyStr, USERS);

    const isLoginRoute =
      pathname === "/login/" || pathname.startsWith("/login/");
    const isPublicAsset = isLoginRoute || pathname === "/favicon.ico";

    // Redirect unauthenticated users to /login/
    if (!user && !isPublicAsset) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login/" }
      });
    }

    // Redirect already-authenticated users away from /login/ back to /
    if (user && (pathname === "/login/" || pathname === "/login/index.html")) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/" }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
