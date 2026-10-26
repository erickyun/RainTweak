/*
 * PrivacyControls companion for the original RainTweak v1.2.0 IPA.
 * This script runs AFTER the bundled/remote stock Rain, and never overwrites Rain.
 * Six independent preferences are edited in RainTweak's shake-to-open Recovery Menu.
 */
(function () {
    "use strict";
    var g = globalThis;
    var installed = false;
    var BLANK_AVATAR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
    var BLANK_NAME = "\u00a0";

    function readSettings() {
        var defaults = {
            hideMessageAvatars: false,
            hideAllAvatars: false,
            hideUsername: false,
            hideDisplayName: false,
            hideGuildTags: false,
            hideEmbedIcons: false
        };
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
        if (!flags.hideMessageAvatars && !flags.hideAllAvatars && !flags.hideUsername && !flags.hideDisplayName && !flags.hideGuildTags && !flags.hideEmbedIcons) {
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

        // Exact fields seen on Discord's native message row. Clear to null,
        // never to an empty string: a blank image URI can break native rendering.
        var GUILD_TAG_KEYS = [
            "clanTag", "clanTagGuildId", "clanBadgeUrl",
            "tagText", "tagAccessibilityLabel", "tagVerified", "tagType",
            "tagIconUrl", "opTagText", "connectionsRoleTag"
        ];
        var SMALL_ICON_KEYS = [
            "icon_url", "proxy_icon_url", "iconUrl", "iconURL",
            "proxyIconUrl", "proxyIconURL", "favicon", "faviconURL", "faviconUrl",
            "avatarURL", "avatarUrl", "avatar_url"
        ];
        function clearFields(source, keys) {
            if (!source || typeof source !== "object" || Array.isArray(source)) return source;
            var copy = null;
            keys.forEach(function (key) {
                if (source[key] != null) {
                    if (!copy) copy = Object.assign({}, source);
                    copy[key] = null;
                }
            });
            return copy || source;
        }
        // Only known *small logo* slots of a link preview are touched.
        // Title, description, URL, author name, thumbnail, image and video
        // remain intact so shared links and forwarded media still work.
        function privateEmbed(embed) {
            if (!embed || typeof embed !== "object" || Array.isArray(embed)) return embed;
            var result = clearFields(embed, [
                "iconUrl", "iconURL", "icon_url", "favicon", "faviconURL", "faviconUrl"
            ]);
            ["author", "provider", "footer"].forEach(function (part) {
                if (!embed[part] || typeof embed[part] !== "object") return;
                var next = clearFields(embed[part], SMALL_ICON_KEYS);
                if (next !== embed[part]) {
                    if (result === embed) result = Object.assign({}, embed);
                    result[part] = next;
                }
            });
            return result;
        }
        function privateEmbedList(list) {
            if (!Array.isArray(list)) return list;
            var changed = false;
            var result = list.map(function (item) {
                var next = privateEmbed(item);
                if (next !== item) changed = true;
                return next;
            });
            return changed ? result : list;
        }
        function privateSnapshot(snapshot, depth) {
            if (!snapshot || typeof snapshot !== "object" || depth > 3) return snapshot;
            var result = snapshot;
            // Discord forwards carry a message_snapshots/messageSnapshots array.
            // A snapshot typically has message.embeds, without the original author.
            ["message", "messageSnapshot", "message_snapshot", "snapshot"].forEach(function (key) {
                if (!snapshot[key] || typeof snapshot[key] !== "object") return;
                var next = privateMessage(snapshot[key], depth + 1);
                if (next !== snapshot[key]) {
                    if (result === snapshot) result = Object.assign({}, snapshot);
                    result[key] = next;
                }
            });
            if (Array.isArray(snapshot.embeds)) {
                var embeds = privateEmbedList(snapshot.embeds);
                if (embeds !== snapshot.embeds) {
                    if (result === snapshot) result = Object.assign({}, snapshot);
                    result.embeds = embeds;
                }
            }
            return result;
        }

        function privateMessage(message, depth) {
            if (!message || typeof message !== "object" || depth > 4) return message;
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
            if (flags.hideGuildTags) {
                GUILD_TAG_KEYS.forEach(function (key) {
                    if (next[key] != null) { next[key] = null; changed = true; }
                });
            }
            if (flags.hideEmbedIcons) {
                if (Array.isArray(message.embeds)) {
                    var embeds = privateEmbedList(message.embeds);
                    if (embeds !== message.embeds) { next.embeds = embeds; changed = true; }
                }
                // Rendered forwards can present either camelCase or wire-format fields.
                ["messageSnapshots", "message_snapshots", "snapshots"].forEach(function (key) {
                    if (!Array.isArray(message[key])) return;
                    var any = false;
                    var snapshots = message[key].map(function (snapshot) {
                        var value = privateSnapshot(snapshot, depth + 1);
                        if (value !== snapshot) any = true;
                        return value;
                    });
                    if (any) { next[key] = snapshots; changed = true; }
                });
                // Some forwarded previews are stored as one nested payload.
                ["forwardedMessage", "forwarded_message", "messageSnapshot"].forEach(function (key) {
                    if (!message[key] || typeof message[key] !== "object") return;
                    var value = privateSnapshot(message[key], depth + 1);
                    if (value !== message[key]) { next[key] = value; changed = true; }
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

        if (flags.hideMessageAvatars || flags.hideAllAvatars || flags.hideDisplayName || flags.hideUsername || flags.hideGuildTags || flags.hideEmbedIcons) {
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
