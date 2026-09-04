import "server-only";import {randomBytes} from "node:crypto";const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateDesireCode(){const bytes=randomBytes(16);let chars="";for(let i=0;i<16;i++)chars+=alphabet[bytes[i]%alphabet.length];return `DDNA-${chars.match(/.{1,4}/g)!.join("-")}`}
export function normalizeDesireCode(input:string){const compact=input.trim().toUpperCase().replace(/[^A-Z2-9]/g,"").replace(/^DDNA/,"");if(compact.length!==16||[...compact].some(x=>!alphabet.includes(x)))return null;return `DDNA-${compact.match(/.{1,4}/g)!.join("-")}`}
export const generateOwnerToken=()=>randomBytes(32).toString("base64url");
