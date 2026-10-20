import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { FluxDispatcher, RestAPI } from "@webpack/common";

const Native = VencordNative.pluginHelpers.RemoteRPC as PluginNative<typeof import("./native")>;

interface Preset {
    name?: string;
    details?: string;
    state?: string;
    type?: number;               // 0 Playing, 1 Streaming, 2 Listening, 3 Watching, 5 Competing
    largeImage?: string;         // image URL
    largeText?: string;
    smallImage?: string;         // image URL
    smallText?: string;
    timer?: boolean | number;    // true = since Discord launched, number = fake "hours ago"
    buttons?: { label: string; url: string; }[];
}

const DEFAULT_CONFIG = JSON.stringify({
    rotateSeconds: 30,
    presets: [
        { name: "My RPC", details: "Edit me in plugin settings", state: "or from GitHub", timer: true }
    ]
}, null, 2);

const settings = definePluginSettings({
    appId: {
        type: OptionType.STRING,
        description: "Application ID from discord.com/developers/applications",
        default: ""
    },
    configUrl: {
        type: OptionType.STRING,
        description: "Optional raw GitHub / gist URL of a config JSON (overrides the local config below)",
        default: ""
    },
    pollSeconds: {
        type: OptionType.NUMBER,
        description: "How often to re-check the remote config (seconds, min 30)",
        default: 60
    },
    localConfig: {
        type: OptionType.STRING,
        description: "Local config JSON (used when no URL is set, or as fallback)",
        default: DEFAULT_CONFIG,
        multiline: true
    } as any
});

const launchTime = Date.now();
const assetCache = new Map<string, string>();

let running = false;
let presets: Preset[] = [];
let rotateMs = 30000;
let idx = 0;
let rotateTimeout: any;
let pollInterval: any;

async function resolveImage(appId: string, img?: string) {
    if (!img) return undefined;
    if (assetCache.has(img)) return assetCache.get(img);
    try {
        const res = await RestAPI.post({
            url: `/applications/${appId}/external-assets`,
            body: { urls: [img] }
        });
        const path = res.body?.[0]?.external_asset_path;
        if (path) {
            const v = `mp:${path}`;
            assetCache.set(img, v);
            return v;
        }
    } catch { }
    return undefined;
}

async function buildActivity(p: Preset) {
    const appId = settings.store.appId;
    const a: any = {
        application_id: appId,
        name: p.name || "RPC",
        type: p.type ?? 0,
        flags: 1
    };
    if (p.details) a.details = p.details;
    if (p.state) a.state = p.state;

    if (typeof p.timer === "number") a.timestamps = { start: Date.now() - p.timer * 3600000 };
    else if (p.timer) a.timestamps = { start: launchTime };

    const large = await resolveImage(appId, p.largeImage);
    const small = await resolveImage(appId, p.smallImage);
    if (large || small) {
        a.assets = {};
        if (large) { a.assets.large_image = large; if (p.largeText) a.assets.large_text = p.largeText; }
        if (small) { a.assets.small_image = small; if (p.smallText) a.assets.small_text = p.smallText; }
    }

    if (p.buttons?.length) {
        const b = p.buttons.slice(0, 2);
        a.buttons = b.map(x => x.label);
        a.metadata = { button_urls: b.map(x => x.url) };
    }
    return a;
}

function push(activity: any) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: "RemoteRPC" });
}

async function loadConfig() {
    const url = settings.store.configUrl.trim();
    let raw = settings.store.localConfig;

    if (url) {
        try {
            raw = await Native.fetchConfig(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);
        } catch {
            if (presets.length) return; // offline: keep what we had
        }
    }
    try {
        const cfg = JSON.parse(raw);
        presets = cfg.presets ?? [cfg];
        rotateMs = Math.max(15, cfg.rotateSeconds ?? 30) * 1000;
    } catch { /* bad JSON mid-edit: keep old */ }
}

async function tick() {
    if (!running) return;
    if (settings.store.appId && presets.length) {
        const p = presets[idx % presets.length];
        idx++;
        push(await buildActivity(p));
    }
    rotateTimeout = setTimeout(tick, rotateMs);
}

export default definePlugin({
    name: "RemoteRPC",
    description: "Custom Rich Presence with rotating statuses, fake timers and optional remote config from GitHub",
    authors: [{ name: "you", id: 0n }],
    settings,

    async start() {
        running = true;
        await loadConfig();
        tick();
        pollInterval = setInterval(loadConfig, Math.max(30, settings.store.pollSeconds) * 1000);
    },

    stop() {
        running = false;
        clearTimeout(rotateTimeout);
        clearInterval(pollInterval);
        push(null);
    }
});
