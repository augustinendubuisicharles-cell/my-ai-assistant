"""Turns a microphone recording into the 16 kHz mono float32 array Whisper wants.
Done with numpy only, so speech recognition doesn't depend on PyAV/ffmpeg versions."""
import numpy as np

WHISPER_RATE = 16_000


def to_whisper_input(sample_rate: int, data: np.ndarray) -> np.ndarray:
    audio = np.asarray(data)
    if audio.ndim == 2:  # (samples, channels) -> mono
        audio = audio.mean(axis=1)
    if np.issubdtype(audio.dtype, np.integer):
        audio = audio.astype(np.float32) / np.iinfo(audio.dtype).max
    audio = audio.astype(np.float32)
    if sample_rate != WHISPER_RATE and len(audio):
        n = int(round(len(audio) * WHISPER_RATE / sample_rate))
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio
