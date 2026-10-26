#!/usr/bin/env python3
"""Replace only the injected RainTweak dylib in the working release IPA.

The original Discord app executable and Rain JS bundle are not rebuilt.
Requires Apple's normal re-signing of modified IPA before installation.
"""
import hashlib
import io
import plistlib
import re
import subprocess
import sys
import tarfile
from pathlib import Path
from zipfile import ZipFile, BadZipFile

def digest(b):
    return hashlib.sha256(b).hexdigest()

def extract_tweak_dylib(deb: Path) -> bytes:
    members = subprocess.check_output(["ar", "t", str(deb)], text=True).splitlines()
    files = [x.strip() for x in members if x.strip().startswith("data.tar")]
    if len(files) != 1:
        raise RuntimeError("Expected one data.tar archive inside the RainTweak DEB")
    raw = subprocess.check_output(["ar", "p", str(deb), files[0]])
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:*") as tar:
        candidates = [m for m in tar.getmembers() if m.isfile()
                      and Path(m.name).name.lower() == "raintweak.dylib"]
        if len(candidates) != 1:
            raise RuntimeError("DEB must contain exactly one RainTweak.dylib, found: "
                               + repr([m.name for m in candidates]))
        binary = tar.extractfile(candidates[0]).read()
        if len(binary) < 10000:
            raise RuntimeError("Suspiciously small RainTweak library")
        return binary

def find_target(entries, archive):
    dylibs = [p for p in entries if p.startswith("Payload/")
              and (p.endswith(".dylib") or p.endswith(".Dylib"))
              and "/Frameworks/" in p]
    exact = [p for p in dylibs if Path(p).name.lower() == "raintweak.dylib"]
    if len(exact) == 1:
        return exact[0]
    # Some IPA injectors rename libraries. Check for the loader's unique native bridge.
    matches = [p for p in dylibs if b"__RAIN_BRIDGE_CALL_SYNC__" in archive.read(p)]
    if len(matches) != 1:
        raise RuntimeError("Could not identify one existing RainTweak dylib in original IPA. "
                           f"Dylibs: {dylibs}; matching bridge: {matches}")
    return matches[0]

def main():
    if len(sys.argv) != 5:
        raise SystemExit("Usage: embed_privacy_into_stock_ipa.py stock.ipa tweak.deb addon.js output.ipa")
    stock, deb, addon, output = map(Path, sys.argv[1:])
    dylib = extract_tweak_dylib(deb)
    addon_bytes = addon.read_bytes()
    if b"[PrivacyControls]" not in addon_bytes:
        raise RuntimeError("Privacy addon content missing")
    if output.exists():
        output.unlink()
    with ZipFile(stock) as original:
        entries = original.namelist()
        apps = {p.split("/")[1] for p in entries if re.match(r"^Payload/[^/]+\\.app/Info\\.plist$", p)}
        if len(apps) != 1:
            raise RuntimeError(f"Expected one iOS app; found {apps}")
        app = apps.pop()
        info = plistlib.loads(original.read(f"Payload/{app}/Info.plist"))
        bundle_id = info.get("CFBundleIdentifier", "")
        if "discord" not in bundle_id.lower():
            raise RuntimeError(f"Unexpected app bundle ID: {bundle_id}")
        target = find_target(entries, original)
        addon_path = f"Payload/{app}/RainPrivacyPlugin.js"
        if addon_path in entries:
            raise RuntimeError("Stock IPA already contains this addon. Refusing duplicate.")
        print("Stock Discord version:", info.get("CFBundleShortVersionString"))
        print("Stock bundle ID:", bundle_id)
        print("Replacing only the injected library:", target)
        print("Old RainTweak SHA256:", digest(original.read(target)))
        print("New RainTweak SHA256:", digest(dylib))

        with ZipFile(output, "w") as patched:
            for zi in original.infolist():
                contents = dylib if zi.filename == target else original.read(zi)
                patched.writestr(zi, contents)
            patched.writestr(addon_path, addon_bytes)
    with ZipFile(stock) as original, ZipFile(output) as result:
        assert result.testzip() is None
        assert set(result.namelist()) == set(original.namelist()) | {addon_path}
        assert result.read(target) == dylib
        assert result.read(addon_path) == addon_bytes
        # Assert not a single original file except the existing tweak was altered.
        for p in original.namelist():
            if p != target and digest(original.read(p)) != digest(result.read(p)):
                raise RuntimeError(f"Original Discord file changed unexpectedly: {p}")
    print("SUCCESS:", output, output.stat().st_size, "bytes")
    print("Original app and stock Rain version preserved; modified IPA is unsigned.")

if __name__ == "__main__":
    main()
