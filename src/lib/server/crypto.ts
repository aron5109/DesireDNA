import "server-only";import {createCipheriv,createDecipheriv,createHmac,randomBytes} from "node:crypto";
export interface Encrypted {ciphertext:string;iv:string;authTag:string}
export function encrypt(value:unknown,key:string):Encrypted{const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",Buffer.from(key,"base64"),iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return{ciphertext:ciphertext.toString("base64"),iv:iv.toString("base64"),authTag:cipher.getAuthTag().toString("base64")}}
export function decrypt<T>(data:Encrypted,key:string):T{const decipher=createDecipheriv("aes-256-gcm",Buffer.from(key,"base64"),Buffer.from(data.iv,"base64"));decipher.setAuthTag(Buffer.from(data.authTag,"base64"));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext,"base64")),decipher.final()]).toString()) as T}
export const hmac=(value:string,key:string)=>createHmac("sha256",key).update(value).digest("hex");
