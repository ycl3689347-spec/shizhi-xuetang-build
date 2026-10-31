#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 App 图标 PNG 压成 iOS 要求的形态：无 alpha 通道的 8 位 RGB。

为什么需要：App Store 和 actool 都要求 AppIcon 不能带透明通道。项目里的图标是
从安卓那边同一张源图缩出来的，带 32 位 RGBA（虽然 alpha 全是 255）。Xcode 15 起
actool 对带 alpha 的 1024 图标会报 "has an alpha channel"，本地可能只是 warning，
上传 App Store 却是硬性拒绝，索性在源头转成 RGB。

用法：
    python ios/scripts/flatten-icon.py            # 处理默认路径
    python ios/scripts/flatten-icon.py a.png b.png

只做两件事：去掉 alpha（要求 alpha 全不透明，有半透明就报错，不静默改画面）、
用 zlib 最优级别重压缩。不缩放、不调色。
"""
import os
import struct
import sys
import zlib

DEFAULT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "Resources", "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png")


def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s 不是 PNG" % path)
    pos = 8
    idat = b""
    w = h = bit = ctype = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bit, ctype = struct.unpack(">IIBB", body[:10])
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
        pos += 12 + ln
    if bit != 8 or ctype not in (2, 6):
        raise ValueError("只支持 8 位 RGB/RGBA，实际 bit=%s ctype=%s" % (bit, ctype))
    return w, h, ctype, idat


def unfilter(raw, w, h, bpp):
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    off = 0
    for _ in range(h):
        ft = raw[off]
        off += 1
        line = bytearray(raw[off:off + stride])
        off += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif ft != 0:
            raise ValueError("未知的行滤波类型 %d" % ft)
        out += line
        prev = line
    return out


def chunk(typ, body):
    return (struct.pack(">I", len(body)) + typ + body
            + struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF))


def write_rgb_png(path, w, h, pixels):
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw += pixels[y * stride:(y + 1) * stride]
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


def flatten(path):
    w, h, ctype, idat = read_png(path)
    raw = zlib.decompress(idat)
    if ctype == 2:
        print("已经是 RGB，跳过：%s" % path)
        return
    px = unfilter(raw, w, h, 4)
    alphas = set(px[3::4])
    if alphas != {255}:
        raise SystemExit("%s 有半透明像素（alpha 取值 %s），先决定怎么合成背景再转"
                         % (path, sorted(alphas)[:6]))
    rgb = bytearray(w * h * 3)
    rgb[0::3] = px[0::4]
    rgb[1::3] = px[1::4]
    rgb[2::3] = px[2::4]
    before = os.path.getsize(path)
    write_rgb_png(path, w, h, rgb)
    after = os.path.getsize(path)
    print("%s %dx%d：RGBA %d KB → RGB %d KB" % (path, w, h, before // 1024, after // 1024))


def main():
    targets = sys.argv[1:] or [DEFAULT]
    for p in targets:
        if not os.path.exists(p):
            raise SystemExit("找不到 %s" % p)
        flatten(p)


if __name__ == "__main__":
    main()
