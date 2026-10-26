"use strict";
// Deterministic privacy addon tests, independent of real Discord and iOS runtime.
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync("addons/RainPrivacyPlugin.js", "utf8");

function build(flags) {
    class RowManager {
        generate(message) { return { message }; }
    }
    const log = [];
    const userStore = { getUser: () => ({ username: "visiblehandle" }) };
    const avatarUtils = {
        getUserAvatarURL: () => "https://cdn.discordapp.com/avatars/123/abc.png",
        getUserAvatarSource: () => ({ uri: "https://cdn.discordapp.com/avatars/123/abc.png" }),
    };
    const nameUtils = {
        getName: () => "Visible Name",
        nameFromUser: () => "Visible Name",
        getUserTag: () => "@visiblehandle",
    };
    const relationshipStore = { getNickname: () => "Nickname" };
    const patcher = {
        after(method, host, callback) {
            assert.equal(typeof host[method], "function");
            const previous = host[method];
            host[method] = function (...args) {
                const result = previous.apply(this, args);
                const modified = callback(args, result);
                return modified === undefined ? result : modified;
            };
            return () => { host[method] = previous; };
        }
    };
    const rain = {
        api: { patcher },
        metro: {
            findByName: name => name === "RowManager" ? RowManager : null,
            findByStoreName: name => name === "UserStore" ? userStore : name === "RelationshipStore" ? relationshipStore : null,
            findByProps: (...keys) =>
                keys.includes("getUserAvatarURL") ? avatarUtils : nameUtils
        }
    };
    const context = {
        rain,
        __RAIN_BRIDGE_CALL_SYNC__: () => ({ result: flags }),
        setTimeout(callback) { callback(); },
        console: { log: (...args) => log.push(args), warn: (...args) => log.push(args) },
    };
    context.globalThis = context;
    vm.runInNewContext(source, context, { filename: "RainPrivacyPlugin.js" });
    return { row: message => new RowManager().generate(message).message, avatarUtils, nameUtils, log };
}

const input = {
    authorId: "123456789012345678",
    username: "Visible Name",
    avatarURL: "https://cdn.discordapp.com/avatars/123/abc.png",
    clanTag: "GAMESIR",
    clanTagGuildId: "987654321098765432",
    clanBadgeUrl: "https://cdn.discordapp.com/badge.png",
    tagText: "GAMESIR",
    embeds: [{
        title: "Article",
        description: "Link preview description",
        url: "https://example.com/article",
        thumbnail: { url: "https://example.com/thumb.jpg" },
        image: { url: "https://example.com/large.jpg" },
        video: { url: "https://example.com/clip.mp4" },
        author: { name: "Site Author", icon_url: "https://example.com/author.png", proxy_icon_url: "https://cdn.proxy/author.png" },
        provider: { name: "Example", iconUrl: "https://example.com/favicon.ico" },
        footer: { text: "Example", iconURL: "https://example.com/footer.png" },
    }],
    message_snapshots: [{
        message: {
            embeds: [{ title: "Forwarded link", author: { icon_url: "https://example.com/forward.png" },
                thumbnail: { url: "https://example.com/forward-thumb.png" } }]
        }
    }],
};

const original = JSON.parse(JSON.stringify(input));
function eq(a, b) { assert.deepEqual(JSON.parse(JSON.stringify(a)), b); }

const disabled = build({});
eq(disabled.row(input), original);
eq(input, original); // no in-place mutation

const tags = build({ hideGuildTags: true }).row(input);
assert.equal(tags.clanTag, null);
assert.equal(tags.clanBadgeUrl, null);
assert.equal(tags.clanTagGuildId, null);
assert.equal(tags.tagText, null);
assert.equal(tags.username, "Visible Name");
assert.equal(tags.avatarURL, original.avatarURL);
eq(tags.embeds, original.embeds);
eq(input, original); // no in-place mutation

const icons = build({ hideEmbedIcons: true }).row(input);
assert.equal(icons.embeds[0].author.icon_url, null);
assert.equal(icons.embeds[0].author.proxy_icon_url, null);
assert.equal(icons.embeds[0].provider.iconUrl, null);
assert.equal(icons.embeds[0].footer.iconURL, null);
assert.equal(icons.embeds[0].author.name, "Site Author");
eq(icons.embeds[0].image, original.embeds[0].image);
eq(icons.embeds[0].thumbnail, original.embeds[0].thumbnail);
eq(icons.embeds[0].video, original.embeds[0].video);
assert.equal(icons.message_snapshots[0].message.embeds[0].author.icon_url, null);
eq(icons.message_snapshots[0].message.embeds[0].thumbnail,
    original.message_snapshots[0].message.embeds[0].thumbnail);
assert.equal(icons.clanTag, original.clanTag);
eq(input, original);

const avatars = build({ hideMessageAvatars: true }).row(input);
assert.match(avatars.avatarURL, /^data:image\/png;base64,/);
assert.equal(avatars.clanTag, original.clanTag);
eq(avatars.embeds, original.embeds);

const names = build({ hideDisplayName: true }).row(input);
assert.equal(names.username, "\u00a0");
assert.equal(names.clanTag, original.clanTag);

const handles = build({ hideUsername: true }).row({ ...input, username: "visiblehandle" });
assert.equal(handles.username, "\u00a0");
const otherHandle = build({ hideUsername: true }).row(input);
assert.equal(otherHandle.username, "Visible Name");

const all = build({ hideGuildTags: true, hideEmbedIcons: true, hideAllAvatars: true }).row(input);
assert.equal(all.clanTag, null);
assert.equal(all.embeds[0].author.icon_url, null);
assert.match(all.avatarURL, /^data:image\/png;base64,/);
eq(input, original);
console.log("PrivacyControls: all isolated and combined row tests passed");
