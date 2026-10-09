"""把一组 PNG 帧编码成 animated WebP（README 内联展示用）。

用 Pillow 而不是 ffmpeg 的 libwebp_anim：后者无法设置关键帧间隔，
浅色渐变背景上会出现明显的方块。
用法: python3 promo/to_webp.py <帧目录> <输出.webp> <每帧毫秒>
"""
import glob
import sys

from PIL import Image

frame_dir, out, duration = sys.argv[1], sys.argv[2], int(sys.argv[3])
frames = [Image.open(f).convert('RGB') for f in sorted(glob.glob(frame_dir + '/*.png'))]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=duration, loop=0,
               quality=85, method=6, kmin=9, kmax=10)
