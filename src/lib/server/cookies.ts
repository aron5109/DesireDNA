import "server-only";import {cookies} from "next/headers";export const OWNER_COOKIE="ddna_owner";
export async function ownerCookie(){return (await cookies()).get(OWNER_COOKIE)?.value}
export async function setOwnerCookie(value:string,maxAge:number){(await cookies()).set(OWNER_COOKIE,value,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge})}
export async function clearOwnerCookie(){(await cookies()).set(OWNER_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0})}
