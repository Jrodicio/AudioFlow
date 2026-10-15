/// <reference types="vite/client" />
interface Window {
  audioflow?: {
    platform: string;
    armCapture(): Promise<void>;
    disarmCapture(): Promise<void>;
    toggleFullscreen(): Promise<boolean>;
    onFullscreen(listener: (value: boolean) => void): () => void;
  };
}
