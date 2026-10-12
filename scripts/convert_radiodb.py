#!/usr/bin/env python3
"""Convert Fieldwatch's packed radiodb.bin (IEEE OUI + Bluetooth SIG tables) into a
compact JSON the web app can lazy-load. Usage: convert_radiodb.py radiodb.bin out.json"""
import json, struct, sys

def main(src, dst):
    b = open(src, "rb").read()
    assert b[:4] == b"SPLK"
    n = struct.unpack_from("<I", b, 12)[0]
    off = {}
    for i in range(n):
        tag = b[16 + 8 * i:20 + 8 * i].rstrip(b"\0").decode()
        off[tag] = struct.unpack_from("<I", b, 20 + 8 * i)[0]
    cnt = struct.unpack_from("<I", b, off["noff"])[0]
    offs = struct.unpack_from(f"<{cnt}I", b, off["noff"] + 4)
    nstr = off["nstr"]
    def name(i):
        s = nstr + offs[i]
        e = b.index(b"\0", s) if i + 1 >= cnt else nstr + offs[i + 1]
        return b[s:e].rstrip(b"\0").decode("utf-8", "replace")
    def pairs(tag, ksz):
        p = off[tag]; c = struct.unpack_from("<I", b, p)[0]
        fmt = "I" if ksz == 4 else "H"
        keys = struct.unpack_from(f"<{c}{fmt}", b, p + 4)
        idx = struct.unpack_from(f"<{c}H", b, p + 4 + ksz * c)
        return keys, idx
    names, ids = [], {}
    def nid(i):
        if i not in ids:
            ids[i] = len(names); names.append(name(i))
        return ids[i]
    k, v = pairs("mal", 4)
    oui = {format(a, "06X"): nid(c) for a, c in zip(k, v)}
    k, v = pairs("btc", 2)
    btc = {str(a): nid(c) for a, c in zip(k, v)}
    k, v = pairs("uuid", 2)
    uuid = {format(a, "04X"): nid(c) for a, c in zip(k, v)}
    k, v = pairs("app", 2)
    app = {str(a): nid(c) for a, c in zip(k, v)}
    json.dump({"names": names, "oui": oui, "btc": btc, "uuid": uuid, "app": app},
              open(dst, "w"), separators=(",", ":"), ensure_ascii=False)
    print(len(names), len(oui), len(btc), len(uuid), len(app))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
