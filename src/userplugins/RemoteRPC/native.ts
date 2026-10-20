import { IpcMainInvokeEvent } from "electron";

const ALLOWED = ["raw.githubusercontent.com", "gist.githubusercontent.com"];

export async function fetchConfig(_: IpcMainInvokeEvent, url: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED.includes(u.hostname))
        throw new Error("Host not allowed");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
}
