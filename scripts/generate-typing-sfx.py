"""生成原创轻敲击声，供总结内容逐字出现时播放。"""
import math
from pathlib import Path
import random
import struct
import wave

# 单个文件包含一次轻敲和一段静音，可由一条循环音轨稳定播放，避免 Player 频繁创建音频节点。
sample_rate = 24000
duration_seconds = .12
click_seconds = .026
samples = round(sample_rate * duration_seconds)
click_samples = round(sample_rate * click_seconds)
noise = random.Random(123)
frames = bytearray()
for index in range(samples):
    if index < click_samples:
        time = index / sample_rate
        envelope = min(1, index / 20) * (1 - index / click_samples) ** 4
        value = (.13 * noise.uniform(-1, 1) + .1 * math.sin(2 * math.pi * 820 * time)) * envelope
    else:
        value = 0
    frames.extend(struct.pack('<h', round(value * 32767)))
with wave.open(str(Path(__file__).resolve().parents[1] / 'public/sfx/typing-key.wav'), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(sample_rate)
    audio.writeframes(frames)
