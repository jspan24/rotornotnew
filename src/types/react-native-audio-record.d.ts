declare module 'react-native-audio-record' {
  export interface AudioRecordOptions {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource?: number;
    wavFile?: string;
  }

  const AudioRecord: {
    init(options: AudioRecordOptions): void;
    start(): void;
    stop(): Promise<string>;
    on(event: 'data', callback: (base64Chunk: string) => void): void;
  };

  export default AudioRecord;
}
