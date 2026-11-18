"""Turn one bounded audio recording into editable text. Audio stays in memory."""

import io
import json
from pathlib import Path
import sys

import av
import numpy as np
import sherpa_onnx


RATE = 16000
MAX_SAMPLES = 32 * RATE


def audio_samples(audio, container_format):
    chunks = []
    count = 0
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
    with av.open(io.BytesIO(audio), format=container_format) as container:
        if not container.streams.audio:
            raise ValueError("Audio stream missing")
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                count += converted.samples
                if count > MAX_SAMPLES:
                    raise ValueError("Recording too long")
                chunks.append(converted.to_ndarray().ravel())
        for converted in resampler.resample(None):
            count += converted.samples
            if count > MAX_SAMPLES:
                raise ValueError("Recording too long")
            chunks.append(converted.to_ndarray().ravel())
    if count < RATE // 4:
        return np.empty(0, dtype=np.float32)
    return np.concatenate(chunks)


def main():
    model_dir = Path(sys.argv[1])
    try:
        samples = audio_samples(sys.stdin.buffer.read(786433), sys.argv[2])
    except (av.error.FFmpegError, ValueError):
        print(json.dumps({"error": "无法读取这段录音，请重新录制"}))
        return
    if not samples.size or np.max(np.abs(samples)) < 0.002:
        print(json.dumps({"text": ""}))
        return
    recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=str(model_dir / "model.int8.onnx"),
        tokens=str(model_dir / "tokens.txt"),
        num_threads=1,
        sample_rate=RATE,
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(RATE, samples)
    recognizer.decode_stream(stream)
    print(json.dumps({"text": stream.result.text.strip()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
