
export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  TRANSCRIBING = 'TRANSCRIBING',
  SYNTHESIZING = 'SYNTHESIZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export type TargetLanguage = 'zh' | 'en';

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  summary: string[];
  targetLang: TargetLanguage; // Track which language was used
  audioBlob?: Blob;
  audioUrl?: string;
}

export interface ProcessingState {
  status: AppStatus;
  progress: number;
  message: string;
  error?: string;
}
