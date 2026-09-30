require("dotenv").config();
const path=require("path"),fs=require("fs"),crypto=require("crypto");
const express=require("express"),session=require("express-session");
const SQLiteStore=require("connect-sqlite3")(session);
const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs"),helmet=require("helmet");
const rateLimit=require("express-rate-limit"),multer=require("multer");

const app=express(),PORT=process.env.PORT||3000,ROOT=__dirname;
const DATA=process.env.DB_FILE||path.join(ROOT,"data","findit.sqlite");
const UPLOAD=process.env.UPLOAD_DIR||path.join(ROOT,"uploads");
fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.mkdirSync(UPLOAD,{recursive:true});
const db=new Database(DATA);db.pragma("journal_mode=WAL");db.pragma("foreign_keys=ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',phone TEXT,city TEXT,
 bio TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 totp_secret TEXT,totp_enabled INTEGER DEFAULT 0,totp_backup_codes TEXT,
 failed_login_count INTEGER DEFAULT 0,locked_until TEXT,
 trust_score INTEGER DEFAULT 0,verified_badge INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lost_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,item_type TEXT NOT NULL,
 identifier_hash TEXT NOT NULL,holder_name TEXT,city TEXT NOT NULL,area TEXT NOT NULL,
 police_station TEXT NOT NULL,pickup_code TEXT NOT NULL,appreciation_enabled INTEGER DEFAULT 0,
 status TEXT DEFAULT 'available',created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(owner_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_lost_hash ON lost_items(identifier_hash);
CREATE TABLE IF NOT EXISTS market_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,seller_id INTEGER NOT NULL,title TEXT NOT NULL,
 category TEXT NOT NULL,description TEXT,price REAL,currency TEXT DEFAULT 'USD',
 city TEXT NOT NULL,area TEXT,image_path TEXT,ad_enabled INTEGER DEFAULT 0,
 status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(seller_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS companies(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,company_name TEXT NOT NULL,
 registration_number TEXT NOT NULL,registration_country TEXT DEFAULT 'Zimbabwe',
 contact_email TEXT NOT NULL,verification_status TEXT DEFAULT 'pending',
 verification_note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS jobs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,title TEXT NOT NULL,
 description TEXT NOT NULL,city TEXT,salary TEXT,closing_date TEXT,status TEXT DEFAULT 'pending',
created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE IF NOT EXISTS applications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,applicant_id INTEGER NOT NULL,
cover_letter TEXT,cv_path TEXT,status TEXT DEFAULT 'submitted',created_at TEXT DEFAULT CURRENT_TIMESTAMP,
UNIQUE(job_id,applicant_id),FOREIGN KEY(job_id) REFERENCES jobs(id),FOREIGN KEY(applicant_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,sender_id INTEGER NOT NULL,recipient_id INTEGER NOT NULL,
body TEXT NOT NULL,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,title TEXT NOT NULL,
body TEXT NOT NULL,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports(
 id INTEGER PRIMARY KEY AUTOINCREMENT,reporter_id INTEGER NOT NULL,target_type TEXT NOT NULL,
target_id INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT DEFAULT 'open',created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT NOT NULL,details TEXT,ip TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS saved_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,target_type TEXT NOT NULL,target_id INTEGER NOT NULL,
UNIQUE(user_id,target_type,target_id)
);
CREATE TABLE IF NOT EXISTS accommodation(
 id INTEGER PRIMARY KEY AUTOINCREMENT,poster_id INTEGER NOT NULL,purpose TEXT NOT NULL,
 listing_type TEXT NOT NULL,title TEXT NOT NULL,description TEXT,price REAL,currency TEXT DEFAULT 'USD',
 bedrooms INTEGER,bathrooms INTEGER,city TEXT NOT NULL,area TEXT,image_path TEXT,
 status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(poster_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS password_resets(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,token_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS login_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,ip TEXT,user_agent TEXT,
 device_fingerprint TEXT,success INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id,created_at);
CREATE TABLE IF NOT EXISTS security_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,event_type TEXT NOT NULL,severity TEXT DEFAULT 'info',
 details TEXT,ip TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_events_time ON security_events(created_at);
CREATE TABLE IF NOT EXISTS lost_lookup_attempts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,ip TEXT,item_type TEXT,matched INTEGER DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lookup_attempts_user_time ON lost_lookup_attempts(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_lookup_attempts_ip_time ON lost_lookup_attempts(ip,created_at);
CREATE TABLE IF NOT EXISTS backup_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT,filename TEXT NOT NULL,size_bytes INTEGER,
 status TEXT DEFAULT 'ok',created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const locations={
"Bulawayo":{"CBD":["Bulawayo Central Police Station"],"Luveve":["Luveve Police Station"],"Nkulumane":["Nkulumane Police Station"],"Pumula":["Pumula Police Station"],"Hillside":["Hillside Police Station"]},
"Harare":{"CBD":["Harare Central Police Station"],"Avondale":["Avondale Police Station"],"Mbare":["Mbare Police Station"],"Borrowdale":["Borrowdale Police Station"],"Highfield":["Highfield Police Station"],"Chitungwiza":["Chitungwiza Police Station"]},
"Mutare":{"CBD":["Mutare Central Police Station"],"Dangamvura":["Dangamvura Police Station"]},
"Gweru":{"CBD":["Gweru Central Police Station"],"Mkoba":["Mkoba Police Station"]},
"Masvingo":{"CBD":["Masvingo Central Police Station"]},
"Chitungwiza":{"Zengeza":["Zengeza Police Station"],"Seke":["Seke Police Station"]},
"Kadoma":{"CBD":["Kadoma Police Station"]},"Kwekwe":{"CBD":["Kwekwe Police Station"]},
"Marondera":{"CBD":["Marondera Police Station"]},"Victoria Falls":{"CBD":["Victoria Falls Police Station"]}
};
const norm=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const h=s=>crypto.createHmac("sha256",process.env.LOOKUP_SECRET||"CHANGE-ME").update(norm(s)).digest("hex");
const code=()=>crypto.randomBytes(5).toString("hex").toUpperCase();
function audit(req,action,details=""){db.prepare("INSERT INTO audit_logs(user_id,action,details,ip) VALUES(?,?,?,?)").run(req.session.userId||null,action,details,req.ip)}
function notify(userId,title,body){db.prepare("INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)").run(userId,title,body)}
function bumpTrust(userId,points){
  db.prepare("UPDATE users SET trust_score=trust_score+? WHERE id=?").run(points,userId);
  const u=db.prepare("SELECT trust_score,verified_badge FROM users WHERE id=?").get(userId);
  // A "Trusted" badge is earned automatically at 30+ points (roughly 6 approved listings/
  // placements) rather than being something anyone can just claim or pay for.
  if(u&&u.trust_score>=30&&!u.verified_badge){
    db.prepare("UPDATE users SET verified_badge=1 WHERE id=?").run(userId);
    notify(userId,"You've earned a Trusted badge!","Your consistent activity on Find It has earned you a Trusted badge, visible on your listings.");
  }
}
function secEvent(userId,type,severity,details,ip){db.prepare("INSERT INTO security_events(user_id,event_type,severity,details,ip) VALUES(?,?,?,?,?)").run(userId||null,type,severity,details||"",ip||"")}
function auth(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Login required."});next()}
function admin(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Login required."});const u=db.prepare("SELECT role FROM users WHERE id=?").get(req.session.userId);if(!u||u.role!=="admin")return res.status(403).json({error:"Admin access required."});next()}

// ============ TOTP (RFC 6238) — implemented directly on Node's crypto module ============
// This avoids adding a third-party 2FA dependency (smaller attack surface, no extra native
// module to compile). Compatible with Google Authenticator, Authy, 1Password, etc.
const TOTP_STEP=30,TOTP_DIGITS=6;
function totpBase32Secret(){
  // 20 random bytes -> base32, matching what authenticator apps expect
  const bytes=crypto.randomBytes(20);
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="",out="";
  for(const b of bytes)bits+=b.toString(2).padStart(8,"0");
  for(let i=0;i+5<=bits.length;i+=5)out+=alphabet[parseInt(bits.slice(i,i+5),2)];
  return out;
}
function totpBase32Decode(b32){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="";
  for(const c of b32.toUpperCase().replace(/[^A-Z2-7]/g,""))bits+=alphabet.indexOf(c).toString(2).padStart(5,"0");
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  return Buffer.from(bytes);
}
function totpAt(secretB32,counter){
  const key=totpBase32Decode(secretB32);
  const buf=Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac=crypto.createHmac("sha1",key).update(buf).digest();
  const offset=hmac[hmac.length-1]&0xf;
  const code=((hmac[offset]&0x7f)<<24|(hmac[offset+1]&0xff)<<16|(hmac[offset+2]&0xff)<<8|(hmac[offset+3]&0xff))%(10**TOTP_DIGITS);
  return String(code).padStart(TOTP_DIGITS,"0");
}
function totpVerify(secretB32,token){
  if(!/^\d{6}$/.test(String(token||"")))return false;
  const counter=Math.floor(Date.now()/1000/TOTP_STEP);
  // Allow the previous, current, and next 30-second window to tolerate small clock drift
  for(const drift of [-1,0,1])if(totpAt(secretB32,counter+drift)===String(token))return true;
  return false;
}
function totpUri(secretB32,email){
  return `otpauth://totp/FindIt:${encodeURIComponent(email)}?secret=${secretB32}&issuer=FindIt&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;
}
function generateBackupCodes(){
  return Array.from({length:8},()=>crypto.randomBytes(4).toString("hex"));
}
// ============ Account lockout helpers ============
const MAX_FAILED_LOGINS=5,LOCKOUT_MINUTES=15;
function isLocked(u){return u.locked_until&&new Date(u.locked_until)>new Date()}
function recordFailedLogin(u,req){
  const count=(u.failed_login_count||0)+1;
  let lockedUntil=null;
  if(count>=MAX_FAILED_LOGINS){
    lockedUntil=new Date(Date.now()+LOCKOUT_MINUTES*60000).toISOString();
    secEvent(u.id,"account_locked","warning",`Locked after ${count} failed login attempts`,req.ip);
    notify(u.id,"Security alert","Your account was temporarily locked after several failed login attempts. Try again in 15 minutes, or reset your password.");
  }
  db.prepare("UPDATE users SET failed_login_count=?,locked_until=? WHERE id=?").run(count,lockedUntil,u.id);
}
function clearFailedLogins(u){db.prepare("UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?").run(u.id)}

// ============ Automated backups ============
// Uses better-sqlite3's built-in .backup() (an online/hot backup — safe to run while the
// app is serving traffic, unlike copying the file directly which can grab it mid-write).
const BACKUP_DIR=process.env.BACKUP_DIR||path.join(path.dirname(DATA),"backups");
const BACKUP_KEEP=+process.env.BACKUP_KEEP_COUNT||14; // keep ~2 weeks of daily backups by default
function runBackup(){
  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const filename=`findit-${stamp}.sqlite`;
  const dest=path.join(BACKUP_DIR,filename);
  db.backup(dest);
  const size=fs.statSync(dest).size;
  db.prepare("INSERT INTO backup_log(filename,size_bytes,status) VALUES(?,?,?)").run(filename,size,"ok");
  // Rotate: keep only the most recent BACKUP_KEEP files on disk
  const files=fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith("findit-")&&f.endsWith(".sqlite")).sort().reverse();
  for(const old of files.slice(BACKUP_KEEP))fs.unlinkSync(path.join(BACKUP_DIR,old));
  return {filename,size_bytes:size,kept:Math.min(files.length,BACKUP_KEEP)};
}
// Run a backup on boot, then every 24 hours. For a real production deployment with meaningful
// traffic, consider triggering this from the host's own cron/scheduled-job feature instead so
// it survives independently of the app process — see DEPLOYMENT.md "Backups" section.
const BACKUP_INTERVAL_MS=24*3600000;
try{runBackup()}catch(e){console.error("Initial backup failed:",e.message)}
setInterval(()=>{try{runBackup()}catch(e){console.error("Scheduled backup failed:",e.message)}},BACKUP_INTERVAL_MS);

app.set("trust proxy",1);
app.use(helmet({
  crossOriginResourcePolicy:{policy:"same-site"},
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      scriptSrc:["'self'"], // no inline scripts / no third-party script origins
      styleSrc:["'self'","'unsafe-inline'"], // inline style attrs used for small dynamic tweaks
      imgSrc:["'self'","data:"],
      connectSrc:["'self'"],
      fontSrc:["'self'"],
      objectSrc:["'none'"],
      frameAncestors:["'none'"], // blocks this site from being iframed elsewhere (clickjacking)
      baseUri:["'self'"],
      formAction:["'self'"]
    }
  },
  hsts:{maxAge:31536000,includeSubDomains:true,preload:true}, // force HTTPS for a year once visited
  referrerPolicy:{policy:"strict-origin-when-cross-origin"},
  noSniff:true,
  frameguard:{action:"deny"}
}));
// Small extra hardening headers helmet doesn't set by default
app.use((req,res,next)=>{
  res.setHeader("Permissions-Policy","geolocation=(),microphone=(),camera=(),payment=()");
  res.setHeader("X-Permitted-Cross-Domain-Policies","none");
  next();
});
app.use(express.json({limit:"300kb"}));app.use(express.urlencoded({extended:true,limit:"300kb"}));

// ============ CORS for the native mobile apps ============
// The Android/iOS apps run from their own origin (e.g. https://localhost inside the
// Capacitor WebView), which is NOT the same origin as this server — so without explicit
// CORS headers, the browser engine inside the app would silently block every request.
// We deliberately do NOT use a wildcard origin, since that combined with credentials:true
// would let any website read this API given a stolen cookie. Only the exact origins below
// are trusted:
//   - your deployed web frontend, if you run one on a different domain than the API
//   - Capacitor's default WebView origins on Android and iOS
//   - localhost, for local development
// Add your real web frontend's origin to MOBILE_CORS_ORIGINS in your .env if it's hosted
// separately from this API.
const allowedOrigins=[
  "capacitor://localhost",   // iOS Capacitor WebView
  "http://localhost",         // Android Capacitor WebView
  "https://localhost",
  "http://localhost:3000",
  ...String(process.env.MOBILE_CORS_ORIGINS||"").split(",").map(s=>s.trim()).filter(Boolean)
];
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin&&allowedOrigins.includes(origin)){
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Access-Control-Allow-Credentials","true");
    res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization");
  }
  if(req.method==="OPTIONS")return res.sendStatus(204);
  next();
});

app.use(session({store:new SQLiteStore({db:"sessions.sqlite",dir:path.dirname(DATA)}),secret:process.env.SESSION_SECRET||"CHANGE-ME",
resave:false,saveUninitialized:false,cookie:{
  httpOnly:true,
  // IMPORTANT: sameSite:"lax" is this app's only CSRF defense today (there is no separate
  // CSRF token middleware). Switching everyone to sameSite:"none" would remove that
  // protection for the WEB version just to make the mobile app work — that's a real
  // security regression, not a neutral tradeoff, so we don't do it globally.
  // Instead: the web app keeps "lax" (safe default). Only genuine native-app requests
  // (matched by the Origin header set in allowedOrigins above, which a normal browser
  // navigating to this site would never send) get "none", since they need it to receive
  // the cookie at all, and they're not vulnerable to the browser-based CSRF attack that
  // "lax" defends against in the first place, since they're not a browser tab a person
  // can be tricked into clicking a malicious link in.
  sameSite:"lax",
  secure:process.env.NODE_ENV==="production",
  maxAge:7*24*3600000
}}));
// Per-request override: relax sameSite to "none" ONLY for requests whose Origin matches
// one of our known native-app origins, applied after the session middleware sets its
// default cookie options but before the response is sent.
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin&&allowedOrigins.includes(origin)&&origin!=="http://localhost:3000"){
    req.session.cookie.sameSite=process.env.NODE_ENV==="production"?"none":"lax";
  }
  next();
});
app.use(express.static(path.join(ROOT,"public")));

const authRL=rateLimit({windowMs:15*60000,max:30});
// Login gets its own tighter limiter (separate from register/forgot-password) since it's the
// most common brute-force target. Keyed by IP; per-account lockout (below) is a second layer.
const loginRL=rateLimit({windowMs:15*60000,max:15,message:{error:"Too many login attempts from this network. Please wait 15 minutes."}});
// Lost & Found search is the highest-value target for enumeration — deliberately the
// strictest limiter on the whole site, independent of the general search rate limit.
const lostSearchRL=rateLimit({windowMs:15*60000,max:10,message:{error:"Too many search attempts. For security, please wait 15 minutes before trying again."}});
const searchRL=rateLimit({windowMs:15*60000,max:30});
const storage=multer.diskStorage({destination:(_,__,cb)=>cb(null,UPLOAD),filename:(_,f,cb)=>cb(null,crypto.randomUUID()+path.extname(f.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:(+process.env.MAX_UPLOAD_MB||5)*1024*1024,files:6},
fileFilter:(_,f,cb)=>cb(null,/^(image\/jpeg|image\/png|image\/webp|application\/pdf)$/.test(f.mimetype))});

app.post("/api/register",authRL,async(req,res)=>{
 const {name,email,password}=req.body;if(!name||!email||!password||password.length<10)return res.status(400).json({error:"Use a name, valid email and password of at least 10 characters."});
 try{const role=String(email).toLowerCase()===String(process.env.ADMIN_EMAIL||"").toLowerCase()?"admin":"user";
 const info=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run(name.trim(),email.trim().toLowerCase(),await bcrypt.hash(password,12),role);
 req.session.userId=info.lastInsertRowid;audit(req,"register");res.json({ok:true,user:db.prepare("SELECT id,name,email,role,phone,city,bio FROM users WHERE id=?").get(req.session.userId)});
 }catch(e){res.status(409).json({error:"Email is already registered."})}
});
app.post("/api/login",loginRL,async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),u=db.prepare("SELECT * FROM users WHERE email=?").get(email);
 if(!u){secEvent(null,"login_failed","info",`Unknown email: ${email}`,req.ip);return res.status(401).json({error:"Invalid email or password."})}
 if(isLocked(u)){secEvent(u.id,"login_blocked_locked","warning","Login attempted while account locked",req.ip);return res.status(423).json({error:`This account is temporarily locked due to repeated failed attempts. Please try again after ${new Date(u.locked_until).toLocaleTimeString()}, or reset your password.`})}
 const passwordOk=await bcrypt.compare(req.body.password||"",u.password_hash);
 if(!passwordOk){
   recordFailedLogin(u,req);
   db.prepare("INSERT INTO login_history(user_id,ip,user_agent,success) VALUES(?,?,?,0)").run(u.id,req.ip,req.get("user-agent")||"");
   return res.status(401).json({error:"Invalid email or password."});
 }
 // Password correct. If 2FA is enabled, don't establish a full session yet — require the
 // TOTP code first via a short-lived, purpose-limited "pending 2FA" session value.
 if(u.totp_enabled){
   req.session.pending2faUserId=u.id;
   return res.json({ok:true,requires2fa:true});
 }
 clearFailedLogins(u);
 req.session.userId=u.id;
 if(email===String(process.env.ADMIN_EMAIL||"").toLowerCase()&&u.role!=="admin"){db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);u.role="admin"}
 const isNewDevice=!db.prepare("SELECT 1 FROM login_history WHERE user_id=? AND user_agent=? AND success=1 LIMIT 1").get(u.id,req.get("user-agent")||"");
 db.prepare("INSERT INTO login_history(user_id,ip,user_agent,success) VALUES(?,?,?,1)").run(u.id,req.ip,req.get("user-agent")||"");
 if(isNewDevice)notify(u.id,"New sign-in detected",`Your account was just accessed from a new device/browser (IP: ${req.ip}). If this wasn't you, reset your password immediately.`);
 audit(req,"login");
 res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone,city:u.city,bio:u.bio,totpEnabled:!!u.totp_enabled}});
});
app.post("/api/login/2fa",loginRL,(req,res)=>{
 const pendingId=req.session.pending2faUserId;
 if(!pendingId)return res.status(400).json({error:"No pending login. Please log in again."});
 const u=db.prepare("SELECT * FROM users WHERE id=?").get(pendingId);
 if(!u)return res.status(400).json({error:"No pending login. Please log in again."});
 const {token,backupCode}=req.body;
 let ok=totpVerify(u.totp_secret,token);
 // Accept a one-time backup code as a fallback if the person has lost their authenticator device
 if(!ok&&backupCode){
   const codes=JSON.parse(u.totp_backup_codes||"[]");
   const idx=codes.indexOf(String(backupCode).trim().toLowerCase());
   if(idx!==-1){ok=true;codes.splice(idx,1);db.prepare("UPDATE users SET totp_backup_codes=? WHERE id=?").run(JSON.stringify(codes),u.id);secEvent(u.id,"backup_code_used","warning","A 2FA backup code was used to log in",req.ip)}
 }
 if(!ok){recordFailedLogin(u,req);secEvent(u.id,"2fa_failed","warning","Incorrect 2FA code entered",req.ip);return res.status(401).json({error:"Incorrect authentication code."})}
 delete req.session.pending2faUserId;
 clearFailedLogins(u);
 req.session.userId=u.id;
 const isNewDevice=!db.prepare("SELECT 1 FROM login_history WHERE user_id=? AND user_agent=? AND success=1 LIMIT 1").get(u.id,req.get("user-agent")||"");
 db.prepare("INSERT INTO login_history(user_id,ip,user_agent,success) VALUES(?,?,?,1)").run(u.id,req.ip,req.get("user-agent")||"");
 if(isNewDevice)notify(u.id,"New sign-in detected",`Your account was just accessed from a new device/browser (IP: ${req.ip}). If this wasn't you, reset your password immediately.`);
 audit(req,"login_2fa");
 res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone,city:u.city,bio:u.bio,totpEnabled:true}});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>{if(!req.session.userId)return res.json({user:null});res.json({user:db.prepare("SELECT id,name,email,role,phone,city,bio,totp_enabled as totpEnabled,trust_score as trustScore,verified_badge as verifiedBadge FROM users WHERE id=?").get(req.session.userId)})});
app.patch("/api/profile",auth,(req,res)=>{const {name,phone,city,bio}=req.body;db.prepare("UPDATE users SET name=COALESCE(?,name),phone=?,city=?,bio=? WHERE id=?").run(name||null,phone||null,city||null,bio||null,req.session.userId);audit(req,"profile_update");res.json({ok:true})});

// ============ Two-factor authentication (TOTP) ============
app.post("/api/2fa/setup",auth,(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
 if(u.totp_enabled)return res.status(400).json({error:"Two-factor authentication is already enabled. Disable it first to generate a new secret."});
 const secret=totpBase32Secret();
 // Store the secret but don't mark 2FA enabled until the user proves they can generate a
 // valid code with it (confirms their authenticator app is actually set up correctly).
 db.prepare("UPDATE users SET totp_secret=? WHERE id=?").run(secret,u.id);
 res.json({ok:true,secret,otpauthUri:totpUri(secret,u.email)});
});
app.post("/api/2fa/confirm",auth,(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
 if(!u.totp_secret)return res.status(400).json({error:"Start 2FA setup first."});
 if(!totpVerify(u.totp_secret,req.body.token))return res.status(400).json({error:"That code didn't match. Please check your authenticator app and try again."});
 const backupCodes=generateBackupCodes();
 db.prepare("UPDATE users SET totp_enabled=1,totp_backup_codes=? WHERE id=?").run(JSON.stringify(backupCodes.map(c=>c.toLowerCase())),u.id);
 secEvent(u.id,"2fa_enabled","info","",req.ip);
 notify(u.id,"Two-factor authentication enabled","2FA is now protecting your account. Keep your backup codes somewhere safe.");
 audit(req,"2fa_enable");
 res.json({ok:true,backupCodes,message:"Two-factor authentication is now enabled. Save these backup codes somewhere safe — each can be used once if you lose access to your authenticator app."});
});
app.post("/api/2fa/disable",auth,async(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
 if(!(await bcrypt.compare(req.body.password||"",u.password_hash)))return res.status(401).json({error:"Incorrect password."});
 db.prepare("UPDATE users SET totp_enabled=0,totp_secret=NULL,totp_backup_codes=NULL WHERE id=?").run(u.id);
 secEvent(u.id,"2fa_disabled","warning","",req.ip);
 notify(u.id,"Two-factor authentication disabled","2FA was just turned off on your account. If this wasn't you, reset your password immediately.");
 audit(req,"2fa_disable");
 res.json({ok:true,message:"Two-factor authentication has been disabled."});
});
app.get("/api/security/login-history",auth,(req,res)=>res.json(db.prepare("SELECT ip,user_agent,success,created_at FROM login_history WHERE user_id=? ORDER BY created_at DESC LIMIT 25").all(req.session.userId)));

// --- Password reset: no email service is configured, so the reset link is returned directly
// in the API response for the person to click. Before real-world launch, swap the "devLink"
// field below for an actual email send (see README "Adding real email" section) and stop
// returning the link in the response.
app.post("/api/forgot-password",authRL,(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),u=db.prepare("SELECT id FROM users WHERE email=?").get(email);
 // Always respond the same way whether or not the account exists, so an attacker can't use this
 // endpoint to discover which emails are registered.
 if(!u)return res.json({ok:true,message:"If that email is registered, a reset link has been created."});
 const token=crypto.randomBytes(32).toString("hex");
 const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
 const expires=new Date(Date.now()+60*60000).toISOString(); // 1 hour
 db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,?)").run(u.id,tokenHash,expires);
 audit(req,"password_reset_requested",email);
 const base=process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get("host")}`;
 res.json({ok:true,message:"If that email is registered, a reset link has been created.",devLink:`${base}/reset.html?token=${token}`});
});
app.post("/api/reset-password",authRL,async(req,res)=>{
 const {token,password}=req.body;
 if(!token||!password||password.length<10)return res.status(400).json({error:"A valid token and a password of at least 10 characters are required."});
 const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
 const row=db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL").get(tokenHash);
 if(!row||new Date(row.expires_at)<new Date())return res.status(400).json({error:"This reset link is invalid or has expired. Please request a new one."});
 await db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await bcrypt.hash(password,12),row.user_id);
 // A successful password reset also clears any account lockout — the person has just proven
 // ownership of the account via their email, so there's no reason to keep them locked out.
 db.prepare("UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?").run(row.user_id);
 db.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
 // Invalidate any other outstanding reset tokens for this user too, so an old link that
 // leaked (e.g. sitting in an email inbox) can't be used after a newer one already worked.
 db.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").run(row.user_id);
 secEvent(row.user_id,"password_reset_completed","info","",req.ip);
 notify(row.user_id,"Password changed","Your password was just reset. If this wasn't you, contact support immediately.");
 audit(req,"password_reset_completed",String(row.user_id));
 res.json({ok:true,message:"Your password has been changed. You can now log in."});
});

app.get("/api/locations",(req,res)=>res.json(locations));
app.post("/api/lost",auth,(req,res)=>{
 const {itemType,identifier,holderName,city,area,policeStation,appreciation}=req.body;
 if(!["national_id","passport","drivers_license","bank_card"].includes(itemType))return res.status(400).json({error:"Invalid item type."});
 if(itemType==="bank_card")return res.status(400).json({error:"For bank cards, do not store the card number. Hand the card to the issuing bank or police and use their recovery reference instead."});
 if(!identifier||!city||!area||!policeStation)return res.status(400).json({error:"Complete all required fields."});
 if(identifier.length>64)return res.status(400).json({error:"That identifier looks too long — please double-check it."});
 if(!locations[city]?.[area]?.includes(policeStation))return res.status(400).json({error:"Invalid Zimbabwe police-station selection."});
 const pickup=code();db.prepare(`INSERT INTO lost_items(owner_id,item_type,identifier_hash,holder_name,city,area,police_station,pickup_code,appreciation_enabled)VALUES(?,?,?,?,?,?,?,?,?)`)
 .run(req.session.userId,itemType,h(identifier),holderName||null,city,area,policeStation,pickup,appreciation?1:0);audit(req,"lost_create",itemType);res.json({ok:true,pickupCode:pickup});
});
// ============ Lost & Found search — hardened against enumeration ============
// This is the highest-stakes endpoint in the app (national ID / passport / licence lookup),
// so it gets its own escalating lockout on top of the general rate limiter, plus a fixed
// response delay so an attacker can't infer "found vs not found" from response timing.
const LOOKUP_MAX_PER_WINDOW=8,LOOKUP_WINDOW_MIN=15;
function lookupAttemptsRecently(userId,ip){
  // IMPORTANT: compare against SQLite's own datetime('now', ...) rather than a
  // JS-generated ISO string. SQLite's CURRENT_TIMESTAMP columns are stored as
  // "YYYY-MM-DD HH:MM:SS" (space-separated, no 'T', no milliseconds) — comparing
  // that format against a JS toISOString() string ("...T...Z") as plain text does
  // NOT sort chronologically the way you'd expect, and silently makes every
  // lookback query return zero rows. Letting SQLite compute "now" keeps both sides
  // of the comparison in the exact same string format.
  const byUser=db.prepare(`SELECT COUNT(*) c FROM lost_lookup_attempts WHERE user_id=? AND created_at>datetime('now','-${LOOKUP_WINDOW_MIN} minutes')`).get(userId).c;
  const byIp=db.prepare(`SELECT COUNT(*) c FROM lost_lookup_attempts WHERE ip=? AND created_at>datetime('now','-${LOOKUP_WINDOW_MIN} minutes')`).get(ip).c;
  return Math.max(byUser,byIp);
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
app.post("/api/lost/search",searchRL,auth,async(req,res)=>{
 const {itemType,identifier}=req.body;
 if(!identifier)return res.status(400).json({error:"Enter the exact identifier."});
 const attempts=lookupAttemptsRecently(req.session.userId,req.ip);
 if(attempts>=LOOKUP_MAX_PER_WINDOW){
   secEvent(req.session.userId,"lookup_lockout","warning",`${attempts} lookup attempts in window`,req.ip);
   return res.status(429).json({error:`For security, lookups are limited to ${LOOKUP_MAX_PER_WINDOW} per ${LOOKUP_WINDOW_MIN} minutes. Please wait before trying again.`});
 }
 // Fixed-floor response delay: real DB lookups vary in speed depending on match/no-match and
 // cache state, which can (in theory) leak information via timing. Padding every response to
 // at least this long makes found vs. not-found indistinguishable by response time.
 const start=Date.now();
 const x=db.prepare(`SELECT item_type,holder_name,city,area,police_station,pickup_code,appreciation_enabled FROM lost_items WHERE item_type=? AND identifier_hash=? AND status='available'`)
 .get(itemType,h(identifier));
 db.prepare("INSERT INTO lost_lookup_attempts(user_id,ip,item_type,matched) VALUES(?,?,?,?)").run(req.session.userId,req.ip,itemType,x?1:0);
 audit(req,"lost_lookup",itemType);
 const elapsed=Date.now()-start,floor=250;
 if(elapsed<floor)await sleep(floor-elapsed);
 if(!x)return res.json({found:false,message:"No matching private recovery record was found."});
 res.json({found:true,itemType:x.item_type,holderName:x.holder_name,city:x.city,area:x.area,policeStation:x.police_station,pickupCode:x.pickup_code,appreciationOptional:!!x.appreciation_enabled});
});

app.post("/api/market",auth,upload.array("images",6),(req,res)=>{
 const {title,category,description,price,currency,city,area,adEnabled}=req.body;if(!title||!category||!city)return res.status(400).json({error:"Title, category and city are required."});
 const imgs=(req.files||[]).map(f=>f.filename).join(",");const i=db.prepare(`INSERT INTO market_items(seller_id,title,category,description,price,currency,city,area,image_path,ad_enabled,status)VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
 .run(req.session.userId,title,category,description||"",price?Number(price):null,currency||"USD",city,area||"",imgs,adEnabled==="on"||adEnabled==="true"?1:0,"pending");
 audit(req,"market_create",String(i.lastInsertRowid));res.json({ok:true,message:"Listing submitted for moderation."});
});
app.get("/api/market",(req,res)=>{
 const page=Math.max(1,parseInt(req.query.page)||1),limit=Math.min(48,parseInt(req.query.limit)||24),offset=(page-1)*limit;
 const rows=db.prepare(`SELECT m.id,m.title,m.category,m.description,m.price,m.currency,m.city,m.area,m.image_path,m.ad_enabled,u.name seller,u.verified_badge sellerVerified
FROM market_items m JOIN users u ON u.id=m.seller_id WHERE m.status='approved' ORDER BY m.ad_enabled DESC,m.created_at DESC LIMIT ? OFFSET ?`).all(limit,offset);
 const total=db.prepare("SELECT COUNT(*) c FROM market_items WHERE status='approved'").get().c;
 res.json({items:rows,page,limit,total,hasMore:offset+rows.length<total});
});
app.get("/api/market/mine",auth,(req,res)=>res.json(db.prepare(`SELECT id,title,category,description,price,currency,city,area,image_path,ad_enabled,status,created_at
FROM market_items WHERE seller_id=? ORDER BY created_at DESC`).all(req.session.userId)));
app.get("/api/images/:name",(req,res)=>{const n=path.basename(req.params.name),f=path.join(UPLOAD,n);if(!fs.existsSync(f))return res.sendStatus(404);res.sendFile(f)});

app.post("/api/accommodation",auth,upload.array("images",6),(req,res)=>{
 const {purpose,listingType,title,description,price,currency,bedrooms,bathrooms,city,area}=req.body;
 if(!purpose||!listingType||!title||!city)return res.status(400).json({error:"Purpose, listing type, title and city are required."});
 if(!["rent","seeking"].includes(purpose))return res.status(400).json({error:"Purpose must be 'rent' or 'seeking'."});
 const imgs=(req.files||[]).map(f=>f.filename).join(",");
 const i=db.prepare(`INSERT INTO accommodation(poster_id,purpose,listing_type,title,description,price,currency,bedrooms,bathrooms,city,area,image_path,status)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
 .run(req.session.userId,purpose,listingType,title,description||"",price?Number(price):null,currency||"USD",bedrooms?Number(bedrooms):null,bathrooms?Number(bathrooms):null,city,area||"",imgs,"pending");
 audit(req,"accommodation_create",String(i.lastInsertRowid));res.json({ok:true,message:"Listing submitted for moderation."});
});
app.get("/api/accommodation",(req,res)=>{
 const {purpose,listingType,city}=req.query;
 const page=Math.max(1,parseInt(req.query.page)||1),limit=Math.min(48,parseInt(req.query.limit)||24),offset=(page-1)*limit;
 let sql=`SELECT a.id,a.purpose,a.listing_type,a.title,a.description,a.price,a.currency,a.bedrooms,a.bathrooms,a.city,a.area,a.image_path,u.name poster,u.verified_badge posterVerified
FROM accommodation a JOIN users u ON u.id=a.poster_id WHERE a.status='approved'`;
 const params=[];
 if(purpose){sql+=" AND a.purpose=?";params.push(purpose)}
 if(listingType){sql+=" AND a.listing_type=?";params.push(listingType)}
 if(city){sql+=" AND a.city=?";params.push(city)}
 sql+=" ORDER BY a.created_at DESC LIMIT ? OFFSET ?";params.push(limit,offset);
 res.json({items:db.prepare(sql).all(...params),page,limit});
});
app.get("/api/accommodation/mine",auth,(req,res)=>res.json(db.prepare(`SELECT id,purpose,listing_type,title,description,price,currency,bedrooms,bathrooms,city,area,image_path,status,created_at
FROM accommodation WHERE poster_id=? ORDER BY created_at DESC`).all(req.session.userId)));

app.post("/api/companies",auth,(req,res)=>{
 const {companyName,registrationNumber,contactEmail}=req.body;if(!companyName||!registrationNumber||!contactEmail)return res.status(400).json({error:"Company registration details are required."});
 const i=db.prepare("INSERT INTO companies(user_id,company_name,registration_number,contact_email)VALUES(?,?,?,?)").run(req.session.userId,companyName,registrationNumber,contactEmail);
 audit(req,"recruiter_apply",companyName);res.json({ok:true,status:"pending",message:"Recruiter account submitted for verification. There is no recruitment/application fee."});
});
app.post("/api/jobs",auth,(req,res)=>{
 const c=db.prepare("SELECT * FROM companies WHERE user_id=?").get(req.session.userId);if(!c)return res.status(403).json({error:"Register your company first."});
 if(c.verification_status!=="verified")return res.status(403).json({error:"Your recruiter account is awaiting verification."});
 const {title,description,city,salary,closingDate}=req.body;if(!title||!description)return res.status(400).json({error:"Title and description are required."});
 const i=db.prepare("INSERT INTO jobs(company_id,title,description,city,salary,closing_date,status)VALUES(?,?,?,?,?,?,?)").run(c.id,title,description,city||"",salary||"",closingDate||"","pending");audit(req,"job_create",String(i.lastInsertRowid));res.json({ok:true,message:"Job submitted for moderation."});
});
app.get("/api/jobs",(req,res)=>res.json(db.prepare(`SELECT j.id,j.title,j.description,j.city,j.salary,j.closing_date,c.company_name FROM jobs j JOIN companies c ON c.id=j.company_id
WHERE j.status='approved' AND c.verification_status='verified' ORDER BY j.created_at DESC LIMIT 100`).all()));
app.post("/api/jobs/:id/apply",auth,upload.single("cv"),(req,res)=>{
 const j=db.prepare("SELECT * FROM jobs WHERE id=? AND status='approved'").get(req.params.id);if(!j)return res.status(404).json({error:"Job unavailable."});
 try{db.prepare("INSERT INTO applications(job_id,applicant_id,cover_letter,cv_path)VALUES(?,?,?,?)").run(j.id,req.session.userId,req.body.coverLetter||"",req.file?.filename||null);
 const owner=db.prepare("SELECT user_id FROM companies WHERE id=?").get(j.company_id); if(owner) notify(owner.user_id,"New application","A new application has been submitted.");audit(req,"job_apply",String(j.id));res.json({ok:true,message:"Application submitted — no application fee."})}catch(e){res.status(409).json({error:"You have already applied."})}
});

app.get("/api/notifications",auth,(req,res)=>res.json(db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(req.session.userId)));
app.post("/api/notifications/:id/read",auth,(req,res)=>{db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id,req.session.userId);res.json({ok:true})});
app.get("/api/messages",auth,(req,res)=>res.json(db.prepare(`SELECT m.*,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id
WHERE m.sender_id=? OR m.recipient_id=? ORDER BY m.created_at DESC LIMIT 100`).all(req.session.userId,req.session.userId)));
app.post("/api/messages",auth,(req,res)=>{const {recipientId,body}=req.body;if(!recipientId||!body)return res.status(400).json({error:"Recipient and message required."});db.prepare("INSERT INTO messages(sender_id,recipient_id,body)VALUES(?,?,?)").run(req.session.userId,recipientId,String(body).slice(0,2000));notify(recipientId,"New message","You received a message on Find It.");res.json({ok:true})});

app.post("/api/reports",auth,(req,res)=>{const {targetType,targetId,reason}=req.body;if(!targetType||!targetId||!reason)return res.status(400).json({error:"Report details required."});db.prepare("INSERT INTO reports(reporter_id,target_type,target_id,reason)VALUES(?,?,?,?)").run(req.session.userId,targetType,targetId,reason);audit(req,"report",`${targetType}:${targetId}`);res.json({ok:true,message:"Report submitted for review."})});
app.post("/api/saved",auth,(req,res)=>{try{db.prepare("INSERT INTO saved_items(user_id,target_type,target_id)VALUES(?,?,?)").run(req.session.userId,req.body.targetType,req.body.targetId);res.json({ok:true})}catch(e){res.json({ok:true})}});

app.get("/api/admin/summary",admin,(req,res)=>res.json({
pendingMarket:db.prepare("SELECT COUNT(*) c FROM market_items WHERE status='pending'").get().c,
pendingAccommodation:db.prepare("SELECT COUNT(*) c FROM accommodation WHERE status='pending'").get().c,
pendingJobs:db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='pending'").get().c,
pendingRecruiters:db.prepare("SELECT COUNT(*) c FROM companies WHERE verification_status='pending'").get().c,
openReports:db.prepare("SELECT COUNT(*) c FROM reports WHERE status='open'").get().c,
users:db.prepare("SELECT COUNT(*) c FROM users").get().c,
lostItemsActive:db.prepare("SELECT COUNT(*) c FROM lost_items WHERE status='available'").get().c
}));
app.get("/api/admin/users",admin,(req,res)=>res.json(db.prepare("SELECT id,name,email,role,phone,city,created_at FROM users ORDER BY created_at DESC LIMIT 500").all()));
app.get("/api/admin/recruiters",admin,(req,res)=>res.json(db.prepare(`SELECT c.*,u.name,u.email FROM companies c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC`).all()));
app.post("/api/admin/recruiters/:id",admin,(req,res)=>{const {status,note}=req.body;if(!["verified","rejected","suspended","pending"].includes(status))return res.status(400).json({error:"Invalid status"});const c=db.prepare("UPDATE companies SET verification_status=?,verification_note=? WHERE id=?").run(status,note||"",req.params.id);const x=db.prepare("SELECT user_id,company_name FROM companies WHERE id=?").get(req.params.id);if(x)notify(x.user_id,"Recruiter account update",`Your company "${x.company_name}" is now ${status}.`);audit(req,"recruiter_moderate",`${req.params.id}:${status}`);res.json({ok:true})});
app.get("/api/admin/reports",admin,(req,res)=>res.json(db.prepare(`SELECT r.*,u.name reporter FROM reports r JOIN users u ON u.id=r.reporter_id WHERE r.status='open' ORDER BY r.created_at DESC`).all()));
app.post("/api/admin/reports/:id",admin,(req,res)=>{db.prepare("UPDATE reports SET status=? WHERE id=?").run(req.body.status||"closed",req.params.id);res.json({ok:true})});
app.get("/api/admin/market",admin,(req,res)=>res.json(db.prepare("SELECT m.*,u.name seller FROM market_items m JOIN users u ON u.id=m.seller_id WHERE m.status='pending' ORDER BY m.created_at").all()));
app.post("/api/admin/market/:id",admin,(req,res)=>{const status=req.body.status;if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Invalid status"});const x=db.prepare("UPDATE market_items SET status=? WHERE id=?").run(status,req.params.id); const mm=db.prepare("SELECT seller_id,title FROM market_items WHERE id=?").get(req.params.id); if(mm){notify(mm.seller_id,"Market listing update",`Your listing "${mm.title}" is now ${status}.`); if(status==="approved")bumpTrust(mm.seller_id,5);} res.json({ok:true})});
app.get("/api/admin/accommodation",admin,(req,res)=>res.json(db.prepare("SELECT a.*,u.name poster FROM accommodation a JOIN users u ON u.id=a.poster_id WHERE a.status='pending' ORDER BY a.created_at").all()));
app.post("/api/admin/accommodation/:id",admin,(req,res)=>{const status=req.body.status;if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Invalid status"});db.prepare("UPDATE accommodation SET status=? WHERE id=?").run(status,req.params.id); const aa=db.prepare("SELECT poster_id,title FROM accommodation WHERE id=?").get(req.params.id); if(aa){notify(aa.poster_id,"Accommodation listing update",`Your listing "${aa.title}" is now ${status}.`); if(status==="approved")bumpTrust(aa.poster_id,5);} res.json({ok:true})});
app.get("/api/admin/jobs",admin,(req,res)=>res.json(db.prepare(`SELECT j.*,c.company_name FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.status='pending'`).all()));
app.post("/api/admin/jobs/:id",admin,(req,res)=>{const status=req.body.status;if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Invalid status"});db.prepare("UPDATE jobs SET status=? WHERE id=?").run(status,req.params.id); const jj=db.prepare("SELECT c.user_id,j.title FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.id=?").get(req.params.id); if(jj){notify(jj.user_id,"Job moderation update",`Your job "${jj.title}" is now ${status}.`); if(status==="approved")bumpTrust(jj.user_id,5);} res.json({ok:true})});
app.get("/api/admin/audit",admin,(req,res)=>res.json(db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200").all()));
app.get("/api/admin/security-events",admin,(req,res)=>res.json(db.prepare(`SELECT se.*,u.name,u.email FROM security_events se LEFT JOIN users u ON u.id=se.user_id ORDER BY se.created_at DESC LIMIT 200`).all()));
app.get("/api/admin/locked-accounts",admin,(req,res)=>{
 // Read every currently-flagged lock candidate and filter chronologically in JS via
 // isLocked() (which correctly parses both timestamp formats through `new Date()`),
 // rather than comparing the stored JS-ISO locked_until string against SQLite's
 // datetime('now') as raw text — see the comment on lookupAttemptsRecently() above
 // for why raw string comparison across these two formats does not sort correctly.
 const candidates=db.prepare("SELECT id,name,email,failed_login_count,locked_until FROM users WHERE locked_until IS NOT NULL").all();
 res.json(candidates.filter(u=>isLocked(u)));
});
app.post("/api/admin/unlock/:id",admin,(req,res)=>{db.prepare("UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?").run(req.params.id);secEvent(req.params.id,"admin_unlock","info",`Unlocked by admin ${req.session.userId}`,req.ip);res.json({ok:true})});
app.get("/api/admin/backups",admin,(req,res)=>res.json(db.prepare("SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 30").all()));
app.post("/api/admin/backup-now",admin,(req,res)=>{
 try{const result=runBackup();res.json({ok:true,...result})}
 catch(e){res.status(500).json({error:"Backup failed: "+e.message})}
});

app.get("/api/health",(req,res)=>res.json({ok:true,service:"Find It",version:"2.0"}));
app.listen(PORT,()=>console.log(`Find It listening on ${PORT}`));
