import { Buffer } from 'buffer';

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file, base64-encoded. */
export function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);

  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf.toString('base64');
}

/** Decode a base64 16-bit PCM mono WAV file into float samples. */
export function decodeWavBase64(base64: string): { samples: Float32Array; sampleRate: number } {
  const buf = Buffer.from(base64, 'base64');
  const sampleRate = buf.readUInt32LE(24);

  // Find the "data" chunk (don't assume a fixed 44-byte header).
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const n = Math.floor(size / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      }
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV data chunk not found');
}

/** Convert a base64 chunk of raw 16-bit PCM into float samples. */
export function pcm16Base64ToFloat(base64: string): Float32Array {
  const buf = Buffer.from(base64, 'base64');
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return out;
}
