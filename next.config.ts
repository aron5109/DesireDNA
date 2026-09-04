import type { NextConfig } from "next";
const security = [{key:"Content-Security-Policy",value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=()"}];
const config: NextConfig={async headers(){return [{source:"/:path*",headers:security},{source:"/(quiz|results|compare)/:path*",headers:[{key:"X-Robots-Tag",value:"noindex, nofollow"},{key:"Cache-Control",value:"no-store"}]}]}};
export default config;
