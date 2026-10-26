/*
 * PrivacyControls companion for the original RainTweak v1.2.0 IPA.
 * This script runs AFTER the bundled/remote stock Rain, and never overwrites Rain.
 * Its four preferences are edited in RainTweak's shake-to-open Recovery Menu.
 */
(function () {
    "use strict";
    var g = globalThis;
    var installed = false;
    var BLANK_AVATAR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
    var BLANK_NAME = "\u00a0";

    function readSettings() {
        var defaults = { hideMessageAvatars: false, hideAllAvatars: false, hideUsername: false, hideDisplayName: false };
        try {
            var bridge = g.__RAIN_BRIDGE_CALL_SYNC__;
            if (typeof bridge !== "function") return defaults;
            var response = bridge({ rain: { method: "privacy.get", args: [] } });
            var data = response && response.result;
            if (!data || typeof data !== "object") return defaults;
            Object.keys(defaults).forEach(function (key) { defaults[key] = data[key] === true; });
        } catch (e) { console.warn("[PrivacyControls] Settings bridge unavailable", e); }
        return defaults;
    }

    function install(rain) {
        if (installed || !rain || !rain.api || !rain.api.patcher || !rain.metro) return;
        var after = rain.api.patcher.after;
        if (typeof after !== "function") return;

        var flags = readSettings();
        if (!flags.hideMessageAvatars && !flags.hideAllAvatars && !flags.hideUsername && !flags.hideDisplayName) {
            installed = true;
            return;
        }

        // Register only checked, callable patch targets: never assume optional
        // Discord exports exist in the currently installed app version.
        function hook(host, method, transform) {
            try {
                if (host && typeof host[method] === "function") {
                    after(method, host, transform);
                    return true;
                }
            } catch (e) { console.warn("[PrivacyControls] Skipped incompatible hook " + method, e); }
            return false;
        }

        function find(method) {
            try { return method(); } catch (e) { console.warn("[PrivacyControls] Module lookup failed", e); }
        }

        var users = find(function () { return rain.metro.findByStoreName("UserStore"); });
        function isUserHandle(authorId, name) {
            if (!users || typeof authorId !== "string") return false;
            try {
                var user = users.getUser(authorId);
                return user && (name === user.username || name === "@" + user.username);
            } catch (e) { return false; }
        }

        function privateMessage(message, depth) {
            if (!message || typeof message !== "object" || depth > 2) return message;
            var next = Object.assign({}, message);
            var changed = false;
            if ((flags.hideMessageAvatars || flags.hideAllAvatars) && typeof next.avatarURL === "string") {
                next.avatarURL = BLANK_AVATAR;
                changed = true;
            }
            if (flags.hideMessageAvatars || flags.hideAllAvatars) {
                ["avatarDecorationURL", "avatarDecorationUrl"].forEach(function (key) {
                    if (next[key] != null) { next[key] = null; changed = true; }
                });
            }
            if (typeof next.username === "string") {
                if (flags.hideDisplayName || (flags.hideUsername && isUserHandle(next.authorId, next.username))) {
                    next.username = BLANK_NAME;
                    changed = true;
                }
            }
            if (next.referencedMessage && next.referencedMessage.message) {
                var child = privateMessage(next.referencedMessage.message, depth + 1);
                if (child !== next.referencedMessage.message) {
                    next.referencedMessage = Object.assign({}, next.referencedMessage, { message: child });
                    changed = true;
                }
            }
            return changed ? next : message;
        }

        if (flags.hideMessageAvatars || flags.hideAllAvatars || flags.hideDisplayName || flags.hideUsername) {
            var manager = find(function () { return rain.metro.findByName("RowManager"); });
            if (manager && manager.prototype) {
                hook(manager.prototype, "generate", function (_args, row) {
                    if (!row || !row.message) return row;
                    var changed = privateMessage(row.message, 0);
                    return changed === row.message ? row : Object.assign({}, row, { message: changed });
                });
            }
        }

        if (flags.hideAllAvatars) {
            var avatarUtil = find(function () {
                return rain.metro.findByProps("getUserAvatarURL", "getUserAvatarSource");
            });
            function blankSource(source) {
                if (typeof source === "string") return BLANK_AVATAR;
                if (typeof source === "number") return { uri: BLANK_AVATAR };
                if (source && typeof source === "object" && typeof source.uri === "string")
                    return Object.assign({}, source, { uri: BLANK_AVATAR });
                return source;
            }
            ["getUserAvatarURL", "getUserAvatarURLWithoutFallback",
             "getGuildMemberAvatarURL", "getGuildMemberAvatarURLSimple",
             "getUserAvatarSource", "getGuildMemberAvatarSource"].forEach(function (method) {
                hook(avatarUtil, method, function (_args, result) { return blankSource(result); });
            });
        }

        if (flags.hideDisplayName || flags.hideUsername) {
            var nameUtil = find(function () {
                return rain.metro.findByProps("getName", "nameFromUser", "getUserTag");
            });
            if (flags.hideDisplayName) {
                ["getName", "useName", "nameFromUser", "getGlobalName", "getFormattedName"].forEach(function (method) {
                    hook(nameUtil, method, function (_args, result) {
                        return typeof result === "string" ? BLANK_NAME : result;
                    });
                });
                var relationshipStore = find(function () {
                    return rain.metro.findByStoreName("RelationshipStore");
                });
                hook(relationshipStore, "getNickname", function (args, result) {
                    return args && typeof args[0] === "string" && /^\d{17,20}$/.test(args[0])
                        && (result == null || typeof result === "string") ? BLANK_NAME : result;
                });
            }
            if (flags.hideUsername) {
                ["getUserTag", "useUserTag"].forEach(function (method) {
                    hook(nameUtil, method, function (_args, result) {
                        return typeof result === "string" ? BLANK_NAME : result;
                    });
                });
            }
        }

        installed = true;
        console.log("[PrivacyControls] Standalone addon activated with stock Rain");
    }

    function run() {
        if (installed || !g.rain) return;
        // Yield startup to Rain so this addon does not block Discord's first render.
        try { install(g.rain); } catch (e) { console.warn("[PrivacyControls] Could not activate", e); }
    }

    try {
        if (g.rain) {
            setTimeout(run, 1200);
        } else {
            var old = Object.getOwnPropertyDescriptor(g, "rain");
            if (!old || old.configurable) {
                var current = old && "value" in old ? old.value : undefined;
                Object.defineProperty(g, "rain", {
                    configurable: true,
                    enumerable: true,
                    get: function () { return current; },
                    set: function (value) { current = value; setTimeout(run, 1200); }
                });
            } else {
                setTimeout(run, 1200);
            }
        }
    } catch (e) { console.warn("[PrivacyControls] Rain initialization watcher failed", e); }
})();
